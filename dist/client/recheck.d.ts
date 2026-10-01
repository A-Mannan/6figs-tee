import type { EnclaveHello, SignedEnvelope, SignedRegistration } from "../shared/types.ts";
import { type ClientAttestationPolicy } from "./attestation.ts";
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
export declare class RecheckClient {
    private readonly fetchImpl;
    private readonly options;
    private helloCache;
    constructor(options: RecheckClientOptions);
    hello(): Promise<EnclaveHello>;
    recheck(input: {
        escrowBlob: SignedEnvelope;
        identityNullifier: string;
        nonce: string;
        timestamp?: number;
    }): Promise<SignedRegistration>;
}
