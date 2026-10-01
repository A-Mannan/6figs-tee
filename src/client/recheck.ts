import { base64urlToBytes } from "../shared/crypto.ts";
import { encryptEnvelope } from "../shared/envelope.ts";
import type {
  EnclaveHello,
  RecheckPayload,
  SignedEnvelope,
  SignedRegistration,
} from "../shared/types.ts";
import { verifyHello, type ClientAttestationPolicy } from "./attestation.ts";
import { RegistrationClientError } from "./register.ts";

export interface RecheckClientOptions {
  enclaveUrl: string;
  policy?: ClientAttestationPolicy;
  fetchImpl?: typeof fetch;
}

/**
 * Server-side helper for the backend trust boundary. It verifies the enclave
 * `/hello` attestation before sending anything, submits an escrow blob for
 * re-verification, and returns the raw signed result. Result signature,
 * attestation, and `expectedNonce` verification stay with the backend's
 * AttestationVerifier so there is a single verification implementation.
 */
export class RecheckClient {
  private readonly fetchImpl: typeof fetch;
  private readonly options: RecheckClientOptions;
  private helloCache: { at: number; hello: EnclaveHello } | null = null;

  constructor(options: RecheckClientOptions) {
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

  async recheck(input: {
    escrowBlob: SignedEnvelope;
    identityNullifier: string;
    nonce: string;
    timestamp?: number;
  }): Promise<SignedRegistration> {
    const hello = await this.hello();
    const payload: RecheckPayload = {
      escrowBlob: input.escrowBlob,
      identityNullifier: input.identityNullifier,
      nonce: input.nonce,
      timestamp: input.timestamp ?? Date.now(),
    };
    const envelope = await encryptEnvelope(
      base64urlToBytes(hello.encryptionPublicKey),
      payload,
    );

    const response = await this.fetchImpl(`${this.options.enclaveUrl}/recheck`, {
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
        error.message ?? `recheck failed (${response.status})`,
      );
    }
    return (await response.json()) as SignedRegistration;
  }
}