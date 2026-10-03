import { DOMAIN } from "../shared/constants.js";
import { canonicalJson, base64urlToBytes, sha256Hex } from "../shared/crypto.js";
import { bindingNonce, keyAttestationNonce, verifyResultSignature, } from "../shared/attestation.js";
import { walletSetNullifier } from "../shared/nullifiers.js";
import { parseJwt, verifyPkiToken, verifyRs256WithJwks } from "./jwt.js";
export { RegistrationService, RegistrationConflict, } from "./service.js";
export { InMemoryNullifierStore, recordFromBody, } from "./store.js";
export { SixFigsVerification } from "./nestjs.js";
export class VerificationError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
const GOOGLE_ISSUER = "https://confidentialcomputing.googleapis.com";
const PKI_ROOT_URL = "https://confidentialcomputing.googleapis.com/.well-known/attestation-pki-root";
export class AttestationVerifier {
    jwksCache = null;
    rootCache = null;
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * Full verification of a signed registration. Returns the trusted body.
     * Throws VerificationError on any failed check — callers should fail closed.
     */
    async verifyRegistration(signed, options = {}) {
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
            throw new VerificationError("bad_identity", "identityNullifier does not match the wallet set");
        }
        if (body.walletNullifiers.length === 0) {
            throw new VerificationError("bad_transition", "at least one wallet must stay enrolled");
        }
        if (this.config.policy.allowedNullifierSchemes.length === 0) {
            throw new VerificationError("policy_not_configured", "allowedNullifierSchemes must not be empty");
        }
        if (!this.config.policy.allowedNullifierSchemes.includes(body.nullifierScheme)) {
            throw new VerificationError("scheme_not_allowed", `nullifier scheme ${String(body.nullifierScheme)} is not allowlisted`);
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
        this.checkAddition(body);
        // 2. The attestation token must be genuine and bound to this key + result.
        const payload = await this.verifyToken(signed.attestationToken, signed.provider);
        const expectedNonce = this.expectedResultNonce(signed.enclavePublicKey, canonicalBody);
        this.requireNonce(payload, expectedNonce);
        // 3. Policy and body integrity.
        if (options.expectedPolicyVersion && body.policyVersion !== options.expectedPolicyVersion) {
            throw new VerificationError("policy_mismatch", `policy version ${body.policyVersion} != expected ${options.expectedPolicyVersion}`);
        }
        if (options.expectedNonce && body.nonce !== options.expectedNonce) {
            throw new VerificationError("nonce_mismatch", "result nonce does not match request nonce");
        }
        this.checkExpiry(body);
        this.checkTier(body);
        this.checkDisclosures(body);
        return body;
    }
    /** Verify the /hello key attestation binds the advertised signing key. */
    async verifyHello(hello) {
        const payload = await this.verifyToken(hello.attestation.attestationToken, hello.provider);
        const signingKey = base64urlToBytes(hello.attestation.publicKey);
        if (sha256Hex(signingKey) !== hello.keyId) {
            throw new VerificationError("bad_keyid", "hello key id does not match the signing key");
        }
        const escrowKey = base64urlToBytes(hello.escrowPublicKey);
        if (escrowKey.length !== 32) {
            throw new VerificationError("bad_keyid", "hello escrow key is malformed");
        }
        const expectedNonce = keyAttestationNonce(signingKey, base64urlToBytes(hello.encryptionPublicKey), escrowKey);
        if (expectedNonce !== hello.attestation.keyNonce) {
            throw new VerificationError("bad_keyid", "hello keys are not attested");
        }
        this.requireNonce(payload, expectedNonce);
        if (this.config.policy.requiredEscrowKeyProviders?.length &&
            !this.config.policy.requiredEscrowKeyProviders.includes(hello.escrowKeyProvider)) {
            throw new VerificationError("escrow_provider_not_allowed", `escrow key provider ${String(hello.escrowKeyProvider)} is not allowlisted`);
        }
    }
    /**
     * Addition results carry exactly three extra fields. They are accepted only
     * together, must reference an identity that actually changed, and the added
     * entries must be part of the resulting wallet set. The backend still checks
     * the transition against its stored bindings; this is the shape gate.
     */
    checkAddition(body) {
        const present = [
            body.previousIdentityNullifier,
            body.addedWalletNullifiers,
            body.nextEscrowBlob,
        ].filter((value) => value !== undefined).length;
        if (present === 0)
            return;
        if (present !== 3) {
            throw new VerificationError("bad_transition", "addition fields must be present together");
        }
        const previous = body.previousIdentityNullifier;
        if (typeof previous !== "string" || !/^[0-9a-f]{64}$/.test(previous)) {
            throw new VerificationError("bad_transition", "previous identity is malformed");
        }
        if (previous === body.identityNullifier) {
            throw new VerificationError("bad_transition", "an addition must change the identity");
        }
        const added = body.addedWalletNullifiers;
        if (!Array.isArray(added) || added.length === 0) {
            throw new VerificationError("bad_transition", "an addition must add at least one wallet");
        }
        const kept = new Set(body.walletNullifiers.map((entry) => entry.walletNullifier));
        for (const entry of added) {
            if (!kept.has(entry.walletNullifier)) {
                throw new VerificationError("bad_transition", "an added wallet is missing from the resulting set");
            }
        }
        const blob = body.nextEscrowBlob;
        if (blob.v !== 1 ||
            typeof blob.epk !== "string" ||
            typeof blob.iv !== "string" ||
            typeof blob.ct !== "string") {
            throw new VerificationError("bad_transition", "nextEscrowBlob is malformed");
        }
    }
    expectedResultNonce(enclavePublicKey, canonicalBody) {
        const payloadHash = sha256Hex(`${DOMAIN.enclaveResult}|${canonicalBody}`);
        return bindingNonce(base64urlToBytes(enclavePublicKey), payloadHash);
    }
    async verifyToken(token, provider) {
        if (provider === "mock") {
            if (!this.config.allowMock) {
                throw new VerificationError("mock_not_allowed", "mock attestation is not accepted here");
            }
            const jwt = parseJwt(token);
            return jwt.payload;
        }
        const jwt = parseJwt(token);
        const alg = jwt.header["alg"];
        let payload;
        if (alg === "RS256" && jwt.header["x5c"]) {
            let root;
            try {
                root = await this.loadPkiRoot();
            }
            catch {
                throw new VerificationError("pki_root_unavailable", "could not load the pinned attestation PKI root");
            }
            try {
                payload = verifyPkiToken(token, root).payload;
            }
            catch (error) {
                throw new VerificationError("pki_invalid", error instanceof Error ? error.message : "PKI verification failed");
            }
        }
        else {
            const jwks = await this.loadJwks();
            payload = verifyRs256WithJwks(token, { keys: jwks.keys }).payload;
        }
        checkTokenClaims(payload, this.config);
        return payload;
    }
    requireNonce(payload, expected) {
        const nonces = payload["eat_nonce"];
        const list = Array.isArray(nonces) ? nonces.map(String) : [String(nonces)];
        if (!list.includes(expected)) {
            throw new VerificationError("nonce_mismatch", "attestation nonce does not bind this result");
        }
    }
    checkExpiry(body) {
        const now = Date.now();
        if (body.expiresAt < now) {
            throw new VerificationError("result_expired", "registration result has expired");
        }
        if (body.createdAt > now + 60_000) {
            throw new VerificationError("result_from_future", "registration createdAt is in the future");
        }
    }
    checkTier(body) {
        if (!Number.isInteger(body.tier) || body.tier < 0 || body.tier > 4) {
            throw new VerificationError("bad_tier", "tier out of range");
        }
        if (body.tierFloorMicroUsd && !/^\d+$/.test(body.tierFloorMicroUsd)) {
            throw new VerificationError("bad_tier", "tier floor is not an integer string");
        }
    }
    /**
     * Disclosed fields are product-visible, so they are shape-checked strictly:
     * symbols are short uppercase alphanumerics ([A-Z0-9], 1–10) and wallet
     * labels are printable ASCII capped at 32. An address can never pass for a
     * label because ':'/'x' … base58/hex strings exceed 32 chars or contain
     * characters outside the set.
     */
    checkDisclosures(body) {
        if (!Array.isArray(body.topAssets) || body.topAssets.length > 3) {
            throw new VerificationError("bad_assets", "topAssets must be an array of at most 3");
        }
        for (const symbol of body.topAssets) {
            if (typeof symbol !== "string" || !/^[A-Z0-9]{1,10}$/.test(symbol)) {
                throw new VerificationError("bad_assets", "topAssets contains a malformed symbol");
            }
        }
        const entries = [
            ...body.walletNullifiers,
            ...(body.removedWalletNullifiers ?? []),
            ...(body.addedWalletNullifiers ?? []),
        ];
        for (const entry of entries) {
            if (entry.label !== undefined && !/^[\x20-\x7E]{1,32}$/.test(String(entry.label))) {
                throw new VerificationError("bad_label", "wallet label is malformed");
            }
        }
    }
    async loadJwks() {
        if (this.config.jwks)
            return this.config.jwks;
        if (this.jwksCache && Date.now() - this.jwksCache.at < 3_600_000)
            return this.jwksCache.jwks;
        const wellKnown = (await fetch(`${GOOGLE_ISSUER}/.well-known/openid-configuration`).then((r) => r.json()));
        const jwks = (await fetch(wellKnown.jwks_uri).then((r) => r.json()));
        this.jwksCache = { at: Date.now(), jwks };
        return jwks;
    }
    async loadPkiRoot() {
        if (this.config.pkiRootPem)
            return this.config.pkiRootPem;
        if (this.rootCache && Date.now() - this.rootCache.at < 86_400_000)
            return this.rootCache.pem;
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
export function checkTokenClaims(payload, config) {
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
    const submods = payload["submods"];
    const container = submods?.["container"];
    const imageDigest = container?.["image_digest"];
    if (config.policy.allowedImageDigests.length === 0) {
        throw new VerificationError("policy_not_configured", "allowedImageDigests must not be empty");
    }
    if (!config.policy.allowedImageDigests.includes(String(imageDigest))) {
        throw new VerificationError("image_not_allowed", `image digest ${String(imageDigest)} is not allowlisted`);
    }
    const gce = submods?.["gce"];
    const projectId = gce?.["project_id"];
    if (config.policy.allowedProjects.length === 0) {
        throw new VerificationError("policy_not_configured", "allowedProjects must not be empty");
    }
    if (!config.policy.allowedProjects.includes(String(projectId))) {
        throw new VerificationError("project_not_allowed", `project ${String(projectId)} is not allowlisted`);
    }
    if (config.policy.allowedZones &&
        config.policy.allowedZones.length > 0 &&
        !config.policy.allowedZones.includes(String(gce?.["zone"]))) {
        throw new VerificationError("zone_not_allowed", "zone is not allowlisted");
    }
    const support = submods?.["confidential_space"]?.["support_attributes"];
    if (config.policy.requiredSupportAttributes?.length) {
        const list = Array.isArray(support) ? support.map(String) : [];
        const missing = config.policy.requiredSupportAttributes.filter((s) => !list.includes(s));
        if (missing.length > 0) {
            throw new VerificationError("support_attribute_missing", `missing support attributes: ${missing.join(", ")}`);
        }
    }
}
