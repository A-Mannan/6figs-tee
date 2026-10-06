import { hexToBytes } from "../shared/crypto.js";
const ESCROW_KEY_BYTES = 32;
const NULLIFIER_KEY_BYTES = 32;
export class EnvEscrowKeyProvider {
    kind = "env";
    raw;
    constructor(raw) {
        this.raw = raw;
    }
    async load() {
        if (!/^[0-9a-fA-F]{64}$/.test(this.raw)) {
            throw new Error("SIXFIGS_ESCROW_KEY must be 64 hex characters (32 bytes)");
        }
        return { escrowPrivateKey: hexToBytes(this.raw), provider: "env" };
    }
}
export class NoneEscrowKeyProvider {
    kind = "none";
    async load() {
        return { escrowPrivateKey: null, provider: "none" };
    }
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
export class GcpKmsEscrowKeyProvider {
    kind = "kms";
    options;
    fetchImpl;
    constructor(options) {
        this.options = options;
        this.fetchImpl = options.fetchImpl ?? fetch;
    }
    async load() {
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
            throw new Error(`KMS released ${escrowKey.length} bytes; the escrow key must be ${ESCROW_KEY_BYTES}`);
        }
        const loaded = {
            escrowPrivateKey: escrowKey,
            provider: "kms",
            keyId: this.options.kmsKey,
        };
        if (this.options.wrappedNullifierKey) {
            const nullifierKey = await this.decrypt(accessToken, this.options.wrappedNullifierKey);
            if (nullifierKey.length !== NULLIFIER_KEY_BYTES) {
                throw new Error(`KMS released ${nullifierKey.length} bytes; the nullifier key must be ${NULLIFIER_KEY_BYTES}`);
            }
            loaded.nullifierKey = nullifierKey;
        }
        return loaded;
    }
    async exchange(subjectToken) {
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
        const parsed = (await response.json());
        if (typeof parsed.access_token !== "string" || parsed.access_token.length === 0) {
            throw new Error("workload identity exchange returned no access token");
        }
        return parsed.access_token;
    }
    async impersonate(federatedToken, serviceAccount) {
        const url = `${IAM_CREDENTIALS_ENDPOINT}/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:generateAccessToken`;
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
        const parsed = (await response.json());
        if (typeof parsed.accessToken !== "string" || parsed.accessToken.length === 0) {
            throw new Error("service account impersonation returned no access token");
        }
        return parsed.accessToken;
    }
    async decrypt(accessToken, wrapped) {
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
                        additionalAuthenticatedData: Buffer.from(this.options.additionalAuthenticatedData).toString("base64"),
                    }
                    : {}),
            }),
        });
        if (!response.ok) {
            throw new Error(`KMS decrypt failed (${response.status})`);
        }
        const parsed = (await response.json());
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
export function selectEscrowKeyProvider(attestation, env = process.env) {
    const kmsKey = (env.SIXFIGS_KMS_KEY ?? "").trim();
    if (kmsKey) {
        const wrapped = (env.SIXFIGS_KMS_WRAPPED_ESCROW_KEY ?? "").trim();
        const stsAudience = (env.SIXFIGS_KMS_STS_AUDIENCE ?? "").trim();
        if (!wrapped) {
            throw new Error("SIXFIGS_KMS_WRAPPED_ESCROW_KEY is required when SIXFIGS_KMS_KEY is configured");
        }
        if (!stsAudience) {
            throw new Error("SIXFIGS_KMS_STS_AUDIENCE is required when SIXFIGS_KMS_KEY is configured");
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
            throw new Error("SIXFIGS_ESCROW_KEY is not accepted in production; configure SIXFIGS_KMS_KEY or set SIXFIGS_ALLOW_ENV_ESCROW_KEY=1 explicitly");
        }
        return new EnvEscrowKeyProvider(envKey);
    }
    return new NoneEscrowKeyProvider();
}
