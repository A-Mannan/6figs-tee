import {
  exportPublicKeys,
  generateEnclaveKeys,
  type EnclaveKeys,
} from "../shared/attestation.ts";
import { hexToBytes } from "../shared/crypto.ts";
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
export class EnclaveKeyManager {
  readonly keys: EnclaveKeys;
  readonly publicKeys: ReturnType<typeof exportPublicKeys>;
  readonly nullifierScheme: NullifierSchemeName;
  readonly escrowPersistent: boolean;
  private helloCache: EnclaveHello | null = null;
  private readonly attestation: AttestationProvider;

  constructor(
    attestation: AttestationProvider,
    nullifierScheme: NullifierSchemeName,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.attestation = attestation;
    const raw = env.SIXFIGS_ESCROW_KEY;
    let escrowPrivate: Uint8Array | undefined;
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

  async hello(policyVersion: string): Promise<EnclaveHello> {
    if (this.helloCache) return this.helloCache;
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