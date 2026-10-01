import { exportPublicKeys, generateEnclaveKeys, } from "../shared/attestation.js";
import { hexToBytes } from "../shared/crypto.js";
/**
 * Owns the enclave's keys for the lifetime of the workload run. Signing and
 * session-encryption keys are ephemeral; the escrow key is loaded from
 * provisioned persistent material (`SIXFIGS_ESCROW_KEY`) so stored address
 * blobs stay decryptable across restarts. Without that material the enclave
 * still serves registrations but refuses rechecks, failing closed.
 */
export class EnclaveKeyManager {
    keys;
    publicKeys;
    nullifierScheme;
    escrowPersistent;
    helloCache = null;
    attestation;
    constructor(attestation, nullifierScheme, env = process.env) {
        this.attestation = attestation;
        const raw = env.SIXFIGS_ESCROW_KEY;
        let escrowPrivate;
        if (raw !== undefined && raw !== "") {
            if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
                throw new Error("SIXFIGS_ESCROW_KEY must be 64 hex characters (32 bytes)");
            }
            escrowPrivate = hexToBytes(raw);
        }
        this.escrowPersistent = escrowPrivate !== undefined;
        this.keys = generateEnclaveKeys(escrowPrivate);
        this.publicKeys = exportPublicKeys(this.keys);
        this.nullifierScheme = nullifierScheme;
    }
    async hello(policyVersion) {
        if (this.helloCache)
            return this.helloCache;
        const attestation = await this.attestation.buildKeyAttestation({
            signingPublicKey: this.keys.signingPublic,
            encryptionPublicKey: this.keys.encryptionPublic,
            escrowPublicKey: this.keys.escrowPublic,
        });
        this.helloCache = {
            v: 1,
            name: "6figs-enclave",
            policyVersion,
            provider: this.attestation.kind,
            encryptionPublicKey: this.publicKeys.encryptionPublicKey,
            escrowPublicKey: this.publicKeys.escrowPublicKey,
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
