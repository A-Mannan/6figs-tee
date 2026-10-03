import { x25519 } from "@noble/curves/ed25519";
import { exportPublicKeys, generateEnclaveKeys, } from "../shared/attestation.js";
import { selectEscrowKeyProvider, } from "./key-provider.js";
/**
 * Owns the enclave's keys for the lifetime of the workload run. Signing and
 * session-encryption keys are ephemeral; the escrow key is loaded once at boot
 * through the configured provider (KMS, environment, or absent) so stored
 * address blobs stay decryptable across restarts. Without persistent material
 * the enclave still serves registrations but refuses rechecks and additions,
 * failing closed.
 */
export class EnclaveKeyManager {
    keys;
    nullifierScheme;
    provider;
    loadedEscrow = null;
    loadPromise = null;
    helloCache = null;
    attestation;
    constructor(attestation, nullifierScheme, env = process.env, provider) {
        this.attestation = attestation;
        this.provider = provider ?? selectEscrowKeyProvider(attestation, env);
        // Signing and encryption keys are ephemeral and generated once. The escrow
        // slot starts as an ephemeral placeholder and is replaced at load.
        this.keys = generateEnclaveKeys();
        this.nullifierScheme = nullifierScheme;
    }
    get publicKeys() {
        return exportPublicKeys(this.keys);
    }
    get escrowPersistent() {
        return this.loadedEscrow !== null && this.loadedEscrow.privateKey !== null;
    }
    get escrowKeyProvider() {
        return this.provider.kind;
    }
    get escrowKeyId() {
        return this.loadedEscrow?.keyId;
    }
    /**
     * Resolve the escrow key exactly once. A failure is sticky and must prevent
     * the server from listening: a KMS-configured enclave that cannot unwrap its
     * key is not allowed to answer with a key it does not hold.
     */
    async ensureEscrowLoaded() {
        if (this.loadedEscrow)
            return;
        this.loadPromise ??= this.provider.load();
        const loaded = await this.loadPromise;
        if (loaded.privateKey) {
            this.keys.escrowPrivate = loaded.privateKey;
            this.keys.escrowPublic = x25519.getPublicKey(loaded.privateKey);
        }
        this.loadedEscrow = loaded;
    }
    async hello(policyVersion) {
        if (this.helloCache)
            return this.helloCache;
        await this.ensureEscrowLoaded();
        const attestation = await this.attestation.buildKeyAttestation({
            signingPublicKey: this.keys.signingPublic,
            encryptionPublicKey: this.keys.encryptionPublic,
            escrowPublicKey: this.keys.escrowPublic,
        });
        const publicKeys = this.publicKeys;
        this.helloCache = {
            v: 1,
            name: "6figs-enclave",
            policyVersion,
            provider: this.attestation.kind,
            encryptionPublicKey: publicKeys.encryptionPublicKey,
            escrowPublicKey: publicKeys.escrowPublicKey,
            escrowKeyProvider: this.provider.kind,
            ...(this.escrowKeyId ? { escrowKeyId: this.escrowKeyId } : {}),
            nullifierScheme: this.nullifierScheme,
            keyId: publicKeys.keyId,
            projectId: this.attestation.projectId,
            zone: this.attestation.zone,
            createdAt: Date.now(),
            attestation,
        };
        return this.helloCache;
    }
}
