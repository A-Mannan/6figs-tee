import { hexToBytes } from "../shared/crypto.ts";
import type { AttestationProvider } from "./attestation-provider.ts";

export type EscrowKeyProviderKind = "kms" | "env" | "none";

export interface LoadedSecrets {
  /** null when no persistent material is configured (provider "none"). */
  escrowPrivateKey: Uint8Array | null;
  /** Present only when a wrapped nullifier key is configured and released. */
  nullifierKey?: Uint8Array;
  provider: EscrowKeyProviderKind;
  /** KMS key resource that released the keys, when applicable. */
  keyId?: string;
}

/**
 * Owns how the long-lived secrets enter the enclave: the escrow private key
 * (64-hex X25519 scalar) and, when configured, the nullifier HMAC key.
 * Providers differ in who can release them; both are raw 32-byte values.
 * Rechecks and wallet additions need persistent escrow material; without it
 * they fail closed.
 */
export interface EscrowKeyProvider {
  readonly kind: EscrowKeyProviderKind;
  load(): Promise<LoadedSecrets>;
}

const ESCROW_KEY_BYTES = 32;
const NULLIFIER_KEY_BYTES = 32;

export class EnvEscrowKeyProvider implements EscrowKeyProvider {
  readonly kind = "env" as const;
  private readonly raw: string;

  constructor(raw: string) {
    this.raw = raw;
  }

  async load(): Promise<LoadedSecrets> {
    if (!/^[0-9a-fA-F]{64}$/.test(this.raw)) {
      throw new Error("SIXFIGS_ESCROW_KEY must be 64 hex characters (32 bytes)");
    }
    return { escrowPrivateKey: hexToBytes(this.raw), provider: "env" };
  }
}

export class NoneEscrowKeyProvider implements EscrowKeyProvider {
  readonly kind = "none" as const;

  async load(): Promise<LoadedSecrets> {
    return { escrowPrivateKey: null, provider: "none" };
  }
}

export interface GcpKmsEscrowKeyProviderOptions {
  /** Cloud KMS resource name: projects/P/locations/L/keyRings/R/cryptoKeys/K. */
  kmsKey: string;
  /** Ciphertext of the 32-byte escrow private key, base64 (standard). */
  wrappedKey: Uint8Array;
  /** Optional ciphertext of the 32-byte nullifier HMAC key. */
  wrappedNullifierKey?: Uint8Array;
  /** Workload identity audience: //iam.googleapis.com/projects/N/locations/global/workloadIdentityPools/P/providers/PR. */
  stsAudience: string;
  /** Service account to impersonate after federation, when required. */
  serviceAccount?: string;
  /** Audience requested from the launcher; defaults to the STS audience. */
  attestationAudience?: string;
  /** Optional additional authenticated data bound to the ciphertext. */
  additionalAuthenticatedData?: Uint8Array;
  attestation: AttestationProvider;
  fetchImpl?: typeof fetch;
}

const STS_ENDPOINT = "https://sts.googleapis.com/v1/token";
const IAM_CREDENTIALS_ENDPOINT = "https://iamcredentials.googleapis.com/v1";
const KMS_ENDPOINT = "https://cloudkms.googleapis.com/v1";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/**
 * Releases the escrow key through Cloud KMS. The only credential is the
 * Confidential Space attestation token: it is exchanged at the GCP Security
 * Token Service for a federated token, optionally impersonates a service
 * account, and the resulting short-lived access token calls KMS. A stolen
 * wrapped key is useless without a workload the KMS IAM policy recognizes.
 */
export class GcpKmsEscrowKeyProvider implements EscrowKeyProvider {
  readonly kind = "kms" as const;
  private readonly options: GcpKmsEscrowKeyProviderOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GcpKmsEscrowKeyProviderOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async load(): Promise<LoadedSecrets> {
    const attestationToken = await this.options.attestation.getToken({
      audience: this.options.attestationAudience ?? this.options.stsAudience,
      nonces: [],
      tokenType: "OIDC",
    });

    const federated = await this.exchange(attestationToken);
    const accessToken = this.options.serviceAccount
      ? await this.impersonate(federated, this.options.serviceAccount)
      : federated;

    const escrowKey = await this.decrypt(accessToken, this.options.wrappedKey);
    if (escrowKey.length !== ESCROW_KEY_BYTES) {
      throw new Error(
        `KMS released ${escrowKey.length} bytes; the escrow key must be ${ESCROW_KEY_BYTES}`,
      );
    }
    const loaded: LoadedSecrets = {
      escrowPrivateKey: escrowKey,
      provider: "kms",
      keyId: this.options.kmsKey,
    };
    if (this.options.wrappedNullifierKey) {
      const nullifierKey = await this.decrypt(accessToken, this.options.wrappedNullifierKey);
      if (nullifierKey.length !== NULLIFIER_KEY_BYTES) {
        throw new Error(
          `KMS released ${nullifierKey.length} bytes; the nullifier key must be ${NULLIFIER_KEY_BYTES}`,
        );
      }
      loaded.nullifierKey = nullifierKey;
    }
    return loaded;
  }

  private async exchange(subjectToken: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: this.options.stsAudience,
      scope: CLOUD_PLATFORM_SCOPE,
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token: subjectToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    });
    const response = await this.fetchImpl(STS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new Error(`workload identity exchange failed (${response.status})`);
    }
    const parsed = (await response.json()) as { access_token?: unknown };
    if (typeof parsed.access_token !== "string" || parsed.access_token.length === 0) {
      throw new Error("workload identity exchange returned no access token");
    }
    return parsed.access_token;
  }

  private async impersonate(federatedToken: string, serviceAccount: string): Promise<string> {
    const url = `${IAM_CREDENTIALS_ENDPOINT}/projects/-/serviceAccounts/${encodeURIComponent(
      serviceAccount,
    )}:generateAccessToken`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${federatedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ scope: [CLOUD_PLATFORM_SCOPE], lifetime: "3600s" }),
    });
    if (!response.ok) {
      throw new Error(`service account impersonation failed (${response.status})`);
    }
    const parsed = (await response.json()) as { accessToken?: unknown };
    if (typeof parsed.accessToken !== "string" || parsed.accessToken.length === 0) {
      throw new Error("service account impersonation returned no access token");
    }
    return parsed.accessToken;
  }

  private async decrypt(accessToken: string, wrapped: Uint8Array): Promise<Uint8Array> {
    const response = await this.fetchImpl(`${KMS_ENDPOINT}/${this.options.kmsKey}:decrypt`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ciphertext: Buffer.from(wrapped).toString("base64"),
        ...(this.options.additionalAuthenticatedData
          ? {
              additionalAuthenticatedData: Buffer.from(
                this.options.additionalAuthenticatedData,
              ).toString("base64"),
            }
          : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`KMS decrypt failed (${response.status})`);
    }
    const parsed = (await response.json()) as { plaintext?: unknown };
    if (typeof parsed.plaintext !== "string") {
      throw new Error("KMS decrypt returned no plaintext");
    }
    return new Uint8Array(Buffer.from(parsed.plaintext, "base64"));
  }
}

/**
 * Boot-time provider selection. KMS wins when configured; the environment key
 * is a dev/staging fallback that production refuses unless the operator sets
 * the explicit override; otherwise there is no persistent escrow material and
 * rechecks/additions are disabled.
 */
export function selectEscrowKeyProvider(
  attestation: AttestationProvider,
  env: NodeJS.ProcessEnv = process.env,
): EscrowKeyProvider {
  const kmsKey = (env.SIXFIGS_KMS_KEY ?? "").trim();
  if (kmsKey) {
    const wrapped = (env.SIXFIGS_KMS_WRAPPED_ESCROW_KEY ?? "").trim();
    const stsAudience = (env.SIXFIGS_KMS_STS_AUDIENCE ?? "").trim();
    if (!wrapped) {
      throw new Error(
        "SIXFIGS_KMS_WRAPPED_ESCROW_KEY is required when SIXFIGS_KMS_KEY is configured",
      );
    }
    if (!stsAudience) {
      throw new Error(
        "SIXFIGS_KMS_STS_AUDIENCE is required when SIXFIGS_KMS_KEY is configured",
      );
    }
    const serviceAccount = (env.SIXFIGS_KMS_SERVICE_ACCOUNT ?? "").trim();
    const attestationAudience = (env.SIXFIGS_KMS_ATTESTATION_AUDIENCE ?? "").trim();
    const aad = env.SIXFIGS_KMS_AAD;
    const wrappedNullifier = (env.SIXFIGS_KMS_WRAPPED_NULLIFIER_KEY ?? "").trim();
    return new GcpKmsEscrowKeyProvider({
      kmsKey,
      wrappedKey: new Uint8Array(Buffer.from(wrapped, "base64")),
      ...(wrappedNullifier
        ? { wrappedNullifierKey: new Uint8Array(Buffer.from(wrappedNullifier, "base64")) }
        : {}),
      stsAudience,
      ...(serviceAccount ? { serviceAccount } : {}),
      ...(attestationAudience ? { attestationAudience } : {}),
      ...(aad ? { additionalAuthenticatedData: new TextEncoder().encode(aad) } : {}),
      attestation,
    });
  }

  const envKey = env.SIXFIGS_ESCROW_KEY;
  if (envKey !== undefined && envKey !== "") {
    if (env.NODE_ENV === "production" && env.SIXFIGS_ALLOW_ENV_ESCROW_KEY !== "1") {
      throw new Error(
        "SIXFIGS_ESCROW_KEY is not accepted in production; configure SIXFIGS_KMS_KEY or set SIXFIGS_ALLOW_ENV_ESCROW_KEY=1 explicitly",
      );
    }
    return new EnvEscrowKeyProvider(envKey);
  }

  return new NoneEscrowKeyProvider();
}