import { exportPublicKeys, type EnclaveKeys } from "../shared/attestation.ts";
import type { NullifierSchemeName } from "../shared/nullifiers.ts";
import type { EnclaveHello } from "../shared/types.ts";
import type { AttestationProvider } from "./attestation-provider.ts";
import { type EscrowKeyProvider, type EscrowKeyProviderKind } from "./key-provider.ts";
/**
 * Owns the enclave's keys for the lifetime of the workload run. Signing and
 * session-encryption keys are ephemeral; the escrow key is loaded once at boot
 * through the configured provider (KMS, environment, or absent) so stored
 * address blobs stay decryptable across restarts. Without persistent material
 * the enclave still serves registrations but refuses rechecks and additions,
 * failing closed.
 */
export declare class EnclaveKeyManager {
    readonly keys: EnclaveKeys;
    readonly nullifierScheme: NullifierSchemeName;
    readonly provider: EscrowKeyProvider;
    private loadedEscrow;
    private loadPromise;
    private helloCache;
    private readonly attestation;
    constructor(attestation: AttestationProvider, nullifierScheme: NullifierSchemeName, env?: NodeJS.ProcessEnv, provider?: EscrowKeyProvider);
    get publicKeys(): ReturnType<typeof exportPublicKeys>;
    get escrowPersistent(): boolean;
    get escrowKeyProvider(): EscrowKeyProviderKind;
    get escrowKeyId(): string | undefined;
    /**
     * Resolve the escrow key exactly once. A failure is sticky and must prevent
     * the server from listening: a KMS-configured enclave that cannot unwrap its
     * key is not allowed to answer with a key it does not hold.
     */
    ensureEscrowLoaded(): Promise<void>;
    hello(policyVersion: string): Promise<EnclaveHello>;
}
