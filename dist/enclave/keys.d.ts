import { exportPublicKeys, type EnclaveKeys } from "../shared/attestation.ts";
import type { NullifierSchemeName } from "../shared/nullifiers.ts";
import type { EnclaveHello } from "../shared/types.ts";
import type { AttestationProvider } from "./attestation-provider.ts";
/**
 * Owns the enclave's keys for the lifetime of the workload run. Signing and
 * session-encryption keys are ephemeral; the escrow key is loaded from
 * provisioned persistent material (`SIXFIGS_ESCROW_KEY`) so stored address
 * blobs stay decryptable across restarts. Without that material the enclave
 * still serves registrations but refuses rechecks, failing closed.
 */
export declare class EnclaveKeyManager {
    readonly keys: EnclaveKeys;
    readonly publicKeys: ReturnType<typeof exportPublicKeys>;
    readonly nullifierScheme: NullifierSchemeName;
    readonly escrowPersistent: boolean;
    private helloCache;
    private readonly attestation;
    constructor(attestation: AttestationProvider, nullifierScheme: NullifierSchemeName, env?: NodeJS.ProcessEnv);
    hello(policyVersion: string): Promise<EnclaveHello>;
}
