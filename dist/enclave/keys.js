import { exportPublicKeys, generateEnclaveKeys, } from "../shared/attestation.js";
/**
 * Owns the enclave's ephemeral keypair for the lifetime of the workload run.
 * Generates keys on construction and produces the hello document that carries
 * both public keys plus a key-attestation token, so a client can verify it is
 * talking to a genuine 6figs enclave before sending anything.
 */
export class EnclaveKeyManager {
    keys;
    publicKeys;
    nullifierScheme;
    helloCache = null;
    attestation;
    constructor(attestation, nullifierScheme) {
        this.attestation = attestation;
        this.keys = generateEnclaveKeys();
        this.publicKeys = exportPublicKeys(this.keys);
        this.nullifierScheme = nullifierScheme;
    }
    async hello(policyVersion) {
        if (this.helloCache)
            return this.helloCache;
        const attestation = await this.attestation.buildKeyAttestation({
            signingPublicKey: this.keys.signingPublic,
            encryptionPublicKey: this.keys.encryptionPublic,
        });
        this.helloCache = {
            v: 1,
            name: "6figs-enclave",
            policyVersion,
            provider: this.attestation.kind,
            encryptionPublicKey: this.publicKeys.encryptionPublicKey,
            nullifierScheme: this.nullifierScheme,
            keyId: this.publicKeys.keyId,
            projectId: this.attestation.projectId,
            zone: this.attestation.zone,
            createdAt: Date.now(),
            attestation,
        };
        return this.helloCache;
    }
}
