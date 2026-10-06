import { base64urlToBytes } from "../shared/crypto.ts";
import { encryptEnvelope } from "../shared/envelope.ts";
import type {
  EnclaveHello,
  SessionRemovalPayload,
  SignedEnvelope,
  SignedRegistration,
} from "../shared/types.ts";
import { verifyHello, type ClientAttestationPolicy } from "./attestation.ts";
import { RegistrationClientError } from "./register.ts";

export interface RemovalClientOptions {
  enclaveUrl: string;
  policy?: ClientAttestationPolicy;
  fetchImpl?: typeof fetch;
}

/**
 * Server-side helper for the backend trust boundary. It verifies the enclave
 * `/hello` attestation before sending anything, submits the stored escrow blob
 * plus the wallet nullifiers to detach, and returns the raw signed result.
 * Signature, attestation, and `expectedNonce` verification stay with the
 * backend's AttestationVerifier so there is a single verification
 * implementation.
 */
export class RemovalClient {
  private readonly fetchImpl: typeof fetch;
  private readonly options: RemovalClientOptions;
  private helloCache: { at: number; hello: EnclaveHello } | null = null;

  constructor(options: RemovalClientOptions) {
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

  async remove(input: {
    escrowBlob: SignedEnvelope;
    identityNullifier: string;
    removeWalletNullifiers: string[];
    nonce: string;
    timestamp?: number;
  }): Promise<SignedRegistration> {
    const hello = await this.hello();
    const payload: SessionRemovalPayload = {
      escrowBlob: input.escrowBlob,
      identityNullifier: input.identityNullifier,
      removeWalletNullifiers: input.removeWalletNullifiers,
      nonce: input.nonce,
      timestamp: input.timestamp ?? Date.now(),
    };
    const envelope = await encryptEnvelope(
      base64urlToBytes(hello.encryptionPublicKey),
      payload,
    );

    const response = await this.fetchImpl(`${this.options.enclaveUrl}/removal`, {
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
        error.message ?? `removal failed (${response.status})`,
      );
    }
    return (await response.json()) as SignedRegistration;
  }
}