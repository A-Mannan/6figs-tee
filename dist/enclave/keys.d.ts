import { exportPublicKeys, type EnclaveKeys } from "../shared/attestation.ts";
import type { NullifierSchemeName } from "../shared/nullifiers.ts";
import type { EnclaveHello } from "../shared/types.ts";
import type { AttestationProvider } from "./attestation-provider.ts";
/**
 * Owns the enclave's ephemeral keypair for the lifetime of the workload run.
 * Generates keys on construction and produces the hello document that carries
 * both public keys plus a key-attestation token, so a client can verify it is
 * talking to a genuine 6figs enclave before sending anything.
 */
export declare class EnclaveKeyManager {
    readonly keys: EnclaveKeys;
    readonly publicKeys: ReturnType<typeof exportPublicKeys>;
    readonly nullifierScheme: NullifierSchemeName;
    private helloCache;
    private readonly attestation;
    constructor(attestation: AttestationProvider, nullifierScheme: NullifierSchemeName);
    hello(policyVersion: string): Promise<EnclaveHello>;
}
