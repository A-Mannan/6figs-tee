import { ownershipChallenge, walletRemovalChallenge } from "../shared/constants.ts";
import { base64urlToBytes, bytesToBase64url, randomBytes } from "../shared/crypto.ts";
import { encryptEnvelope } from "../shared/envelope.ts";
import { walletEntriesFromAddresses, walletSetNullifier } from "../shared/nullifiers.ts";
import type { Disclosure } from "../shared/constants.ts";
import type {
  EnclaveHello,
  RegistrationRequest,
  SignedEnvelope,
  SignedRegistration,
  WalletInput,
} from "../shared/types.ts";
import {
  verifyHello,
  verifyRegistrationAttestation,
  type ClientAttestationPolicy,
} from "./attestation.ts";

export interface WalletDescriptor {
  family: "evm" | "solana";
  chainId: number;
  address: string;
}

export interface PreparedRegistration {
  nonce: string;
  timestamp: number;
  identityNullifier: string;
  /** The exact string every enrolled wallet must sign to prove ownership. */
  message: string;
  wallets: WalletDescriptor[];
  disclosure: Disclosure;
  /** Wallets being detached in this transition. */
  removals: WalletDescriptor[];
  /** Removal consent string per removed wallet, keyed `family:lowercaseAddress`. */
  removalMessages: Record<string, string>;
}

function descriptorKey(wallet: WalletDescriptor): string {
  return `${wallet.family}:${wallet.address.toLowerCase()}`;
}

export interface RegistrationClientOptions {
  enclaveUrl: string;
  policy?: ClientAttestationPolicy;
  fetchImpl?: typeof fetch;
}

/**
 * Two-phase registration client:
 *
 *   1. prepare()  — verifies the enclave attestation, generates the request
 *                   nonce (or adopts a caller-supplied session nonce), and
 *                   returns the message to sign.
 *   2. submit()   — takes the wallet signatures over that message, encrypts
 *                   everything to the enclave, and returns the verified result.
 *
 * The secret and nonce never leave the page except encrypted to the enclave.
 */
export class RegistrationClient {
  private readonly fetchImpl: typeof fetch;
  private readonly options: RegistrationClientOptions;
  private helloCache: { at: number; hello: EnclaveHello } | null = null;

  constructor(options: RegistrationClientOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async hello(): Promise<EnclaveHello> {
    if (this.helloCache && Date.now() - this.helloCache.at < 60_000) {
      return this.helloCache.hello;
    }
    const response = await this.fetchImpl(`${this.options.enclaveUrl}/hello`);
    if (!response.ok) throw new Error(`enclave hello failed: ${response.status}`);
    const hello = (await response.json()) as EnclaveHello;
    await verifyHello(hello, this.options.policy ?? {});
    this.helloCache = { at: Date.now(), hello };
    return hello;
  }

  /**
   * Phase 1: verify the enclave and produce the messages wallets must sign.
   * `wallets` is the set to keep; `remove` lists wallets to detach. The
   * backend infers the previous account from its stored bindings, so the
   * client never needs to know it; every enrolled wallet must still sign,
   * which is what makes silent shrinkage impossible.
   */
  prepare(input: {
    wallets: WalletDescriptor[];
    remove?: WalletDescriptor[];
    disclosure?: Disclosure;
    timestamp?: number;
    /** Caller session nonce, echoed into the request so the backend can bind
     * the result to its session. Must be at least 8 characters; the enclave
     * enforces the minimum. Generated randomly when omitted. */
    nonce?: string;
  }): PreparedRegistration {
    const nonce = input.nonce ?? bytesToBase64url(randomBytes(24));
    const timestamp = input.timestamp ?? Date.now();
    const removals = input.remove ?? [];
    if (removals.length > 0 && input.wallets.length === 0) {
      throw new Error("at least one wallet must stay enrolled");
    }
    const identityNullifier = walletSetNullifier(walletEntriesFromAddresses(input.wallets));
    const message = ownershipChallenge({
      identityNullifier,
      wallets: input.wallets,
      timestamp,
      nonce,
    });

    const removalMessages: Record<string, string> = {};
    for (const wallet of removals) {
      removalMessages[descriptorKey(wallet)] = walletRemovalChallenge({
        family: wallet.family,
        address: wallet.address,
        nextIdentityNullifier: identityNullifier,
        timestamp,
        nonce,
      });
    }

    return {
      nonce,
      timestamp,
      identityNullifier,
      message,
      wallets: input.wallets,
      disclosure: input.disclosure ?? "hidden",
      removals,
      removalMessages,
    };
  }

  /** Phase 2: submit signatures and get the verified signed result. */
  async submit(input: {
    prepared: PreparedRegistration;
    signatures: Record<string, string>;
    removalSignatures?: Record<string, string>;
  }): Promise<SignedRegistration> {
    const hello = await this.hello();
    const { prepared, signatures } = input;
    const removalSignatures = input.removalSignatures ?? {};

    const wallets: WalletInput[] = prepared.wallets.map((wallet) => {
      const signature = signatures[descriptorKey(wallet)];
      if (!signature) throw new Error(`missing signature for wallet ${wallet.address}`);
      return {
        family: wallet.family,
        chainId: wallet.chainId,
        address: wallet.address,
        signature,
      };
    });

    const removals: WalletInput[] = prepared.removals.map((wallet) => {
      const signature = removalSignatures[descriptorKey(wallet)];
      if (!signature) throw new Error(`missing removal signature for wallet ${wallet.address}`);
      return {
        family: wallet.family,
        chainId: wallet.chainId,
        address: wallet.address,
        signature,
      };
    });

    const request: RegistrationRequest = {
      nonce: prepared.nonce,
      timestamp: prepared.timestamp,
      wallets,
      disclosure: prepared.disclosure,
      ...(removals.length > 0 ? { removals } : {}),
    };

    const envelope: SignedEnvelope = await encryptEnvelope(
      base64urlToBytes(hello.encryptionPublicKey),
      { request },
    );

    const response = await this.fetchImpl(`${this.options.enclaveUrl}/registration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      throw new RegistrationClientError(
        error.error ?? "enclave_error",
        error.message ?? `registration failed (${response.status})`,
      );
    }

    const result = (await response.json()) as SignedRegistration;
    await verifyRegistrationAttestation(result, this.options.policy ?? {});

    // The result must come from the enclave whose keys hello advertised.
    if (result.body.nullifierScheme !== hello.nullifierScheme) {
      throw new RegistrationClientError(
        "scheme_mismatch",
        "enclave result uses an unexpected nullifier scheme",
      );
    }
    // Only the legacy scheme is client-computable. Under a keyed scheme the
    // browser cannot recompute identities; the attested enclave and the
    // backend verifier own those checks.
    if (hello.nullifierScheme === "legacy-v1") {
      if (result.body.identityNullifier !== prepared.identityNullifier) {
        throw new RegistrationClientError(
          "identity_mismatch",
          "enclave result is for a different wallet set",
        );
      }
      if (removals.length > 0) {
        const expected = walletEntriesFromAddresses(prepared.removals)
          .map((entry) => entry.walletNullifier)
          .sort();
        const actual = (result.body.removedWalletNullifiers ?? [])
          .map((entry) => entry.walletNullifier)
          .sort();
        if (JSON.stringify(expected) !== JSON.stringify(actual)) {
          throw new RegistrationClientError(
            "transition_mismatch",
            "enclave result detached a different wallet set",
          );
        }
      }
    }
    return result;
  }
}

export class RegistrationClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

