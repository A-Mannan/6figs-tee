import { x25519 } from "@noble/curves/ed25519";
import {
  exportPublicKeys,
  generateEnclaveKeys,
  type EnclaveKeys,
} from "../shared/attestation.ts";
import type { NullifierScheme } from "../shared/nullifiers.ts";
import type { EnclaveHello } from "../shared/types.ts";
import type { AttestationProvider } from "./attestation-provider.ts";
import {
  selectEscrowKeyProvider,
  type EscrowKeyProvider,
  type EscrowKeyProviderKind,
  type LoadedSecrets,
} from "./key-provider.ts";

/**
 * The key-attestation token the launcher mints has a short TTL (one hour). The
 * hello response caches the ephemeral keys for the workload's lifetime, but the
 * token must be re-minted before it expires or every client that verifies
 * attestation will reject the enclave. Refresh comfortably inside the window.
 */
const HELLO_CACHE_TTL_MS = 30 * 60_000;

/**
 * Owns the enclave's keys for the lifetime of the workload run. Signing and
 * session-encryption keys are ephemeral; the escrow key is loaded once at boot
 * through the configured provider (KMS, environment, or absent) so stored
 * address blobs stay decryptable across restarts. Without persistent material
 * the enclave still serves registrations but refuses rechecks and additions,
 * failing closed.
 */
export class EnclaveKeyManager {
  readonly keys: EnclaveKeys;
  readonly nullifierScheme: NullifierScheme;
  readonly provider: EscrowKeyProvider;
  private loadedSecrets: LoadedSecrets | null = null;
  private loadPromise: Promise<LoadedSecrets> | null = null;
  private helloCache: EnclaveHello | null = null;
  private helloCacheAt = 0;
  private readonly attestation: AttestationProvider;

  constructor(
    attestation: AttestationProvider,
    nullifierScheme: NullifierScheme,
    env: NodeJS.ProcessEnv = process.env,
    provider?: EscrowKeyProvider,
  ) {
    this.attestation = attestation;
    this.provider = provider ?? selectEscrowKeyProvider(attestation, env);
    // Signing and encryption keys are ephemeral and generated once. The escrow
    // slot starts as an ephemeral placeholder and is replaced at load.
    this.keys = generateEnclaveKeys();
    this.nullifierScheme = nullifierScheme;
  }

  get publicKeys(): ReturnType<typeof exportPublicKeys> {
    return exportPublicKeys(this.keys);
  }

  get escrowPersistent(): boolean {
    return this.loadedSecrets !== null && this.loadedSecrets.escrowPrivateKey !== null;
  }

  get escrowKeyProvider(): EscrowKeyProviderKind {
    return this.provider.kind;
  }

  get escrowKeyId(): string | undefined {
    return this.loadedSecrets?.keyId;
  }

  /**
   * Resolve the persistent secrets exactly once. A failure is sticky and must
   * prevent the server from listening: a KMS-configured enclave that cannot
   * unwrap its keys is not allowed to answer with keys it does not hold.
   */
  async ensureEscrowLoaded(): Promise<void> {
    if (this.loadedSecrets) return;
    this.loadPromise ??= this.provider.load();
    const loaded = await this.loadPromise;
    if (loaded.escrowPrivateKey) {
      this.keys.escrowPrivate = loaded.escrowPrivateKey;
      this.keys.escrowPublic = x25519.getPublicKey(loaded.escrowPrivateKey);
    }
    if (loaded.nullifierKey) this.nullifierScheme.setKey!(loaded.nullifierKey);
    if (this.nullifierScheme.pending) {
      throw new Error("the configured key provider did not release the nullifier key");
    }
    this.loadedSecrets = loaded;
  }

  async hello(policyVersion: string): Promise<EnclaveHello> {
    if (
      this.helloCache &&
      Date.now() - this.helloCacheAt < HELLO_CACHE_TTL_MS
    ) {
      return this.helloCache;
    }
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
      nullifierScheme: this.nullifierScheme.name,
      keyId: publicKeys.keyId,
      projectId: this.attestation.projectId,
      zone: this.attestation.zone,
      createdAt: Date.now(),
      attestation,
    };
    this.helloCacheAt = Date.now();
    return this.helloCache;
  }
}