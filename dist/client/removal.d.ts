import type { EnclaveHello, SignedEnvelope, SignedRegistration } from "../shared/types.ts";
import { type ClientAttestationPolicy } from "./attestation.ts";
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
export declare class RemovalClient {
    private readonly fetchImpl;
    private readonly options;
    private helloCache;
    constructor(options: RemovalClientOptions);
    hello(): Promise<EnclaveHello>;
    remove(input: {
        escrowBlob: SignedEnvelope;
        identityNullifier: string;
        removeWalletNullifiers: string[];
        nonce: string;
        timestamp?: number;
    }): Promise<SignedRegistration>;
}
