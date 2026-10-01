import { asBufferSource, base64urlToBytes, canonicalJson, sha256Hex, utf8, } from "../shared/crypto.js";
import { bindingNonce, keyAttestationNonce, verifyResultSignature, } from "../shared/attestation.js";
import { DOMAIN } from "../shared/constants.js";
const GOOGLE_ISSUER = "https://confidentialcomputing.googleapis.com";
const MOCK_ISSUER = "https://mock.6figs.local/attestation";
const JWKS_CACHE_TTL_MS = 3_600_000;
const FETCH_TIMEOUT_MS = 10_000;
let jwksCache = null;
/** Test hook: clear the module JWKS cache. */
export function clearJwksCache() {
    jwksCache = null;
}
async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
async function loadJwks(policy) {
    if (policy.jwks)
        return policy.jwks;
    const ttl = policy.jwksCacheTtlMs ?? JWKS_CACHE_TTL_MS;
    if (jwksCache && Date.now() - jwksCache.at < ttl)
        return jwksCache.jwks;
    const timeout = policy.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
    const wellKnown = (await fetchWithTimeout(`${GOOGLE_ISSUER}/.well-known/openid-configuration`, timeout).then((r) => r.json()));
    const jwks = (await fetchWithTimeout(wellKnown.jwks_uri, timeout).then((r) => r.json()));
    jwksCache = { at: Date.now(), jwks };
    return jwks;
}
/**
 * Browser-side verification of an attestation token using WebCrypto. Confirms
 * the enclave is a genuine Confidential Space workload before the client sends
 * any encrypted request to it. This is what makes the "we can't peek either"
 * claim checkable by the user.
 */
export async function verifyAttestationToken(token, audience, policy = {}) {
    const parts = token.split(".");
    if (parts.length !== 3)
        throw new Error("malformed attestation token");
    const header = JSON.parse(new TextDecoder().decode(base64urlToBytes(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(parts[1])));
    if (header.alg !== "RS256") {
        if (policy.allowMock && header.alg === "none" && payload.iss === MOCK_ISSUER) {
            return payload;
        }
        throw new Error("unsupported attestation alg");
    }
    const jwks = await loadJwks(policy);
    const jwk = jwks.keys.find((k) => k.kid === header.kid || k.kid === undefined);
    if (!jwk || typeof jwk.n !== "string" || typeof jwk.e !== "string") {
        throw new Error("no matching JWK for attestation token");
    }
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, asBufferSource(base64urlToBytes(parts[2])), asBufferSource(utf8(`${parts[0]}.${parts[1]}`)));
    if (!ok)
        throw new Error("attestation signature invalid");
    assertAttestationClaims(payload, audience, policy);
    return payload;
}
/**
 * Claim checks for a signature-validated attestation token. Image digest and
 * project allowlists are mandatory: an empty list rejects the token instead of
 * silently disabling the check.
 */
export function assertAttestationClaims(payload, audience, policy) {
    if (payload.iss !== GOOGLE_ISSUER)
        throw new Error("unexpected attestation issuer");
    if (payload.aud !== audience)
        throw new Error("attestation audience mismatch");
    if (payload.swname !== "CONFIDENTIAL_SPACE") {
        throw new Error("not a Confidential Space workload");
    }
    if (payload.dbgstat !== "disabled-since-boot")
        throw new Error("debug enclave image rejected");
    if (Number(payload.exp) * 1000 < Date.now())
        throw new Error("attestation expired");
    const submods = (payload.submods ?? {});
    const digests = policy.allowedImageDigests ?? [];
    if (digests.length === 0)
        throw new Error("no allowedImageDigests configured");
    const imageDigest = submods.container?.image_digest;
    if (!digests.includes(String(imageDigest))) {
        throw new Error(`image digest ${String(imageDigest)} is not allowed`);
    }
    const projects = policy.allowedProjects ?? [];
    if (projects.length === 0)
        throw new Error("no allowedProjects configured");
    const projectId = submods.gce?.project_id;
    if (!projects.includes(String(projectId))) {
        throw new Error(`project ${String(projectId)} is not allowed`);
    }
    if (policy.requiredSupportAttributes?.length) {
        const attrs = Array.isArray(submods.confidential_space?.support_attributes)
            ? submods.confidential_space.support_attributes.map(String)
            : [];
        for (const required of policy.requiredSupportAttributes) {
            if (!attrs.includes(required))
                throw new Error(`missing support attribute ${required}`);
        }
    }
}
/** Verify the key-attestation carried in a /hello response. */
export async function verifyHello(hello, policy = {}) {
    const payload = await verifyAttestationToken(hello.attestation.attestationToken, "6figs-enclave-key", policy);
    const signingKey = base64urlToBytes(hello.attestation.publicKey);
    if (sha256Hex(signingKey) !== hello.keyId) {
        throw new Error("hello key id does not match the attested signing key");
    }
    const expectedNonce = keyAttestationNonce(signingKey, base64urlToBytes(hello.encryptionPublicKey));
    if (expectedNonce !== hello.attestation.keyNonce) {
        throw new Error("hello encryption key is not covered by the attestation");
    }
    const nonces = Array.isArray(payload.eat_nonce) ? payload.eat_nonce : [payload.eat_nonce];
    if (!nonces.includes(expectedNonce))
        throw new Error("hello attestation nonce mismatch");
    return payload;
}
/** Verify the attestation attached to a registration response. */
export async function verifyRegistrationAttestation(signed, policy = {}) {
    const payload = await verifyAttestationToken(signed.attestationToken, "6figs-registration", policy);
    const canonicalBody = canonicalJson(signed.body);
    if (!verifyResultSignature(signed.enclavePublicKey, canonicalBody, signed.signature)) {
        throw new Error("enclave result signature invalid");
    }
    const payloadHash = sha256Hex(`${DOMAIN.enclaveResult}|${canonicalBody}`);
    const expected = bindingNonce(base64urlToBytes(signed.enclavePublicKey), payloadHash);
    const nonces = Array.isArray(payload.eat_nonce) ? payload.eat_nonce : [payload.eat_nonce];
    if (!nonces.includes(expected))
        throw new Error("result attestation nonce mismatch");
}
