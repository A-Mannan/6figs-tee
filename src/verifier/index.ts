import { DOMAIN } from "../shared/constants.ts";
import { canonicalJson, base64urlToBytes, sha256Hex } from "../shared/crypto.ts";
import {
  bindingNonce,
  keyAttestationNonce,
  verifyResultSignature,
} from "../shared/attestation.ts";
import { walletSetNullifier } from "../shared/nullifiers.ts";
import type {
  EnclaveHello,
  RegistrationResultBody,
  SignedRegistration,
} from "../shared/types.ts";
import { parseJwt, verifyPkiToken, verifyRs256WithJwks, type Jwk } from "./jwt.ts";

export {
  RegistrationService,
  RegistrationConflict,
  type RegistrationServiceOptions,
} from "./service.ts";
export {
  InMemoryNullifierStore,
  recordFromBody,
  type NullifierStore,
  type StoredRegistration,
} from "./store.ts";
export { SixFigsVerification, type SixFigsVerificationOptions } from "./nestjs.ts";

export interface EnclavePolicy {
  /** Container image digests the backend will accept. Must not be empty. */
  allowedImageDigests: string[];
  /** GCP project ids the enclave is allowed to run in. Must not be empty. */
  allowedProjects: string[];
  /** Nullifier schemes the backend will accept, e.g. ["keyed-v1"]. Must not be empty. */
  allowedNullifierSchemes: string[];
  /** GCP zones, optional. */
  allowedZones?: string[];
  /** Support attributes that must be present, e.g. ["STABLE"]. */
  requiredSupportAttributes?: string[];
  /** Whether debug images (dbgstat === "enabled") are acceptable. */
  allowDebug?: boolean;
}

export interface VerifierConfig {
  audience: string;
  policy: EnclavePolicy;
  /** Accept tokens issued by the mock provider. Never enable in production. */
  allowMock?: boolean;
  /** Override the JWKS document (tests / offline verification). */
  jwks?: { keys: Array<Record<string, unknown>> };
  /** Pin the PKI root certificate PEM. Falls back to the HTTPS endpoint. */
  pkiRootPem?: string;
  /** Clock skew tolerance in ms. Default 60s. */
  clockSkewMs?: number;
}

export class VerificationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const GOOGLE_ISSUER = "https://confidentialcomputing.googleapis.com";
const PKI_ROOT_URL = "https://confidentialcomputing.googleapis.com/.well-known/attestation-pki-root";

interface JwksCache {
  at: number;
  jwks: { keys: Array<Record<string, unknown>> };
}

export class AttestationVerifier {
  private jwksCache: JwksCache | null = null;
  private rootCache: { at: number; pem: string } | null = null;
  private readonly config: VerifierConfig;

  constructor(config: VerifierConfig) {
    this.config = config;
  }

  /**
   * Full verification of a signed registration. Returns the trusted body.
   * Throws VerificationError on any failed check — callers should fail closed.
   */
  async verifyRegistration(
    signed: SignedRegistration,
    options: { expectedNonce?: string; expectedPolicyVersion?: string } = {},
  ): Promise<RegistrationResultBody> {
    const body = signed.body;
    const canonicalBody = canonicalJson(body);

    // 1. The signature must verify against the embedded enclave key.
    if (!verifyResultSignature(signed.enclavePublicKey, canonicalBody, signed.signature)) {
      throw new VerificationError("bad_signature", "enclave signature does not verify");
    }
    if (sha256Hex(base64urlToBytes(signed.enclavePublicKey)) !== signed.keyId) {
      throw new VerificationError("bad_keyid", "enclavePublicKey does not match keyId");
    }

    // The signed identity must be the commitment of exactly this wallet set.
    if (walletSetNullifier(body.walletNullifiers) !== body.identityNullifier) {
      throw new VerificationError(
        "bad_identity",
        "identityNullifier does not match the wallet set",
      );
    }

    if (body.walletNullifiers.length === 0) {
      throw new VerificationError("bad_transition", "at least one wallet must stay enrolled");
    }
    if (this.config.policy.allowedNullifierSchemes.length === 0) {
      throw new VerificationError(
        "policy_not_configured",
        "allowedNullifierSchemes must not be empty",
      );
    }
    if (!this.config.policy.allowedNullifierSchemes.includes(body.nullifierScheme)) {
      throw new VerificationError(
        "scheme_not_allowed",
        `nullifier scheme ${String(body.nullifierScheme)} is not allowlisted`,
      );
    }

    // A removal must not keep and remove the same wallet. The previous
    // identity is inferred by the service from stored bindings, never claimed.
    const removed = body.removedWalletNullifiers ?? [];
    if (removed.length > 0) {
      const kept = new Set(body.walletNullifiers.map((w) => w.walletNullifier));
      if (removed.some((w) => kept.has(w.walletNullifier))) {
        throw new VerificationError("bad_transition", "a wallet cannot be kept and removed");
      }
    }

    // 2. The attestation token must be genuine and bound to this key + result.
    const payload = await this.verifyToken(signed.attestationToken, signed.provider);
    const expectedNonce = this.expectedResultNonce(signed.enclavePublicKey, canonicalBody);
    this.requireNonce(payload, expectedNonce);

    // 3. Policy and body integrity.
    if (options.expectedPolicyVersion && body.policyVersion !== options.expectedPolicyVersion) {
      throw new VerificationError(
        "policy_mismatch",
        `policy version ${body.policyVersion} != expected ${options.expectedPolicyVersion}`,
      );
    }
    if (options.expectedNonce && body.nonce !== options.expectedNonce) {
      throw new VerificationError("nonce_mismatch", "result nonce does not match request nonce");
    }
    this.checkExpiry(body);
    this.checkTier(body);

    return body;
  }

  /** Verify the /hello key attestation binds the advertised signing key. */
  async verifyHello(hello: EnclaveHello): Promise<void> {
    const payload = await this.verifyToken(hello.attestation.attestationToken, hello.provider);
    const signingKey = base64urlToBytes(hello.attestation.publicKey);
    if (sha256Hex(signingKey) !== hello.keyId) {
      throw new VerificationError("bad_keyid", "hello key id does not match the signing key");
    }
    const expectedNonce = keyAttestationNonce(
      signingKey,
      base64urlToBytes(hello.encryptionPublicKey),
    );
    if (expectedNonce !== hello.attestation.keyNonce) {
      throw new VerificationError("bad_keyid", "hello encryption key is not attested");
    }
    this.requireNonce(payload, expectedNonce);
  }

  private expectedResultNonce(enclavePublicKey: string, canonicalBody: string): string {
    const payloadHash = sha256Hex(`${DOMAIN.enclaveResult}|${canonicalBody}`);
    return bindingNonce(base64urlToBytes(enclavePublicKey), payloadHash);
  }

  private async verifyToken(
    token: string,
    provider: "confidential-space" | "mock",
  ): Promise<Record<string, unknown>> {
    if (provider === "mock") {
      if (!this.config.allowMock) {
        throw new VerificationError("mock_not_allowed", "mock attestation is not accepted here");
      }
      const jwt = parseJwt(token);
      return jwt.payload;
    }

    const jwt = parseJwt(token);
    const alg = jwt.header["alg"];
    let payload: Record<string, unknown>;
    if (alg === "RS256" && jwt.header["x5c"]) {
      let root: string;
      try {
        root = await this.loadPkiRoot();
      } catch {
        throw new VerificationError(
          "pki_root_unavailable",
          "could not load the pinned attestation PKI root",
        );
      }
      try {
        payload = verifyPkiToken(token, root).payload;
      } catch (error) {
        throw new VerificationError(
          "pki_invalid",
          error instanceof Error ? error.message : "PKI verification failed",
        );
      }
    } else {
      const jwks = await this.loadJwks();
      payload = verifyRs256WithJwks(token, { keys: jwks.keys as unknown as Jwk[] }).payload;
    }

    checkTokenClaims(payload, this.config);
    return payload;
  }

  private requireNonce(payload: Record<string, unknown>, expected: string): void {
    const nonces = payload["eat_nonce"];
    const list = Array.isArray(nonces) ? nonces.map(String) : [String(nonces)];
    if (!list.includes(expected)) {
      throw new VerificationError("nonce_mismatch", "attestation nonce does not bind this result");
    }
  }

  private checkExpiry(body: RegistrationResultBody): void {
    const now = Date.now();
    if (body.expiresAt < now) {
      throw new VerificationError("result_expired", "registration result has expired");
    }
    if (body.createdAt > now + 60_000) {
      throw new VerificationError("result_from_future", "registration createdAt is in the future");
    }
  }

  private checkTier(body: RegistrationResultBody): void {
    if (!Number.isInteger(body.tier) || body.tier < 0 || body.tier > 4) {
      throw new VerificationError("bad_tier", "tier out of range");
    }
    if (body.tierFloorMicroUsd && !/^\d+$/.test(body.tierFloorMicroUsd)) {
      throw new VerificationError("bad_tier", "tier floor is not an integer string");
    }
  }

  private async loadJwks(): Promise<{ keys: Array<Record<string, unknown>> }> {
    if (this.config.jwks) return this.config.jwks;
    if (this.jwksCache && Date.now() - this.jwksCache.at < 3_600_000) return this.jwksCache.jwks;
    const wellKnown = (await fetch(
      `${GOOGLE_ISSUER}/.well-known/openid-configuration`,
    ).then((r) => r.json())) as { jwks_uri: string };
    const jwks = (await fetch(wellKnown.jwks_uri).then((r) => r.json())) as {
      keys: Array<Record<string, unknown>>;
    };
    this.jwksCache = { at: Date.now(), jwks };
    return jwks;
  }

  private async loadPkiRoot(): Promise<string> {
    if (this.config.pkiRootPem) return this.config.pkiRootPem;
    if (this.rootCache && Date.now() - this.rootCache.at < 86_400_000) return this.rootCache.pem;
    const pem = await fetch(PKI_ROOT_URL).then((r) => r.text());
    if (!pem || pem.trim().length === 0) {
      throw new Error("empty attestation PKI root response");
    }
    this.rootCache = { at: Date.now(), pem };
    return pem;
  }
}

/**
 * Claim checks for a signature-validated attestation token. The image digest
 * and project allowlists are mandatory: an empty list rejects every real token
 * instead of silently disabling the check.
 */
export function checkTokenClaims(
  payload: Record<string, unknown>,
  config: { audience: string; policy: EnclavePolicy; clockSkewMs?: number },
): void {
  const now = Date.now() / 1000;
  const skew = (config.clockSkewMs ?? 60_000) / 1000;
  const iss = payload["iss"];
  if (iss !== GOOGLE_ISSUER) {
    throw new VerificationError("bad_issuer", `unexpected issuer ${String(iss)}`);
  }
  const aud = payload["aud"];
  if (aud !== config.audience && !(Array.isArray(aud) && aud.includes(config.audience))) {
    throw new VerificationError("bad_audience", "attestation audience mismatch");
  }
  const exp = Number(payload["exp"]);
  if (!Number.isFinite(exp) || exp + skew < now) {
    throw new VerificationError("token_expired", "attestation token expired");
  }
  const nbf = Number(payload["nbf"] ?? 0);
  if (Number.isFinite(nbf) && nbf - skew > now) {
    throw new VerificationError("token_not_yet_valid", "attestation token not yet valid");
  }
  if (payload["swname"] !== "CONFIDENTIAL_SPACE") {
    throw new VerificationError("bad_swname", "workload is not running under Confidential Space");
  }
  const dbgstat = payload["dbgstat"];
  if (!config.policy.allowDebug && dbgstat !== "disabled-since-boot") {
    throw new VerificationError("debug_image", "attestation comes from a debug image");
  }

  const submods = payload["submods"] as Record<string, any> | undefined;
  const container = submods?.["container"];
  const imageDigest = container?.["image_digest"];
  if (config.policy.allowedImageDigests.length === 0) {
    throw new VerificationError(
      "policy_not_configured",
      "allowedImageDigests must not be empty",
    );
  }
  if (!config.policy.allowedImageDigests.includes(String(imageDigest))) {
    throw new VerificationError(
      "image_not_allowed",
      `image digest ${String(imageDigest)} is not allowlisted`,
    );
  }

  const gce = submods?.["gce"];
  const projectId = gce?.["project_id"];
  if (config.policy.allowedProjects.length === 0) {
    throw new VerificationError(
      "policy_not_configured",
      "allowedProjects must not be empty",
    );
  }
  if (!config.policy.allowedProjects.includes(String(projectId))) {
    throw new VerificationError(
      "project_not_allowed",
      `project ${String(projectId)} is not allowlisted`,
    );
  }
  if (
    config.policy.allowedZones &&
    config.policy.allowedZones.length > 0 &&
    !config.policy.allowedZones.includes(String(gce?.["zone"]))
  ) {
    throw new VerificationError("zone_not_allowed", "zone is not allowlisted");
  }

  const support = submods?.["confidential_space"]?.["support_attributes"];
  if (config.policy.requiredSupportAttributes?.length) {
    const list = Array.isArray(support) ? support.map(String) : [];
    const missing = config.policy.requiredSupportAttributes.filter((s) => !list.includes(s));
    if (missing.length > 0) {
      throw new VerificationError(
        "support_attribute_missing",
        `missing support attributes: ${missing.join(", ")}`,
      );
    }
  }
}
