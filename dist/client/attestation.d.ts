import type { EnclaveHello, SignedRegistration } from "../shared/types.ts";
export interface ClientAttestationPolicy {
    /** Image digests to accept. Must not be empty for real tokens. */
    allowedImageDigests?: string[];
    /** GCP project ids to accept. Must not be empty for real tokens. */
    allowedProjects?: string[];
    /** Required support attributes, e.g. ["STABLE"]. */
    requiredSupportAttributes?: string[];
    /**
     * Accept structurally-valid mock attestations (local development only).
     * Never enable in production: mock tokens are not cryptographically signed.
     */
    allowMock?: boolean;
    /** Pinned JWKS document. When set, Google is never fetched. */
    jwks?: {
        keys: Array<Record<string, unknown>>;
    };
    /** JWKS cache TTL in ms. Default 3_600_000. */
    jwksCacheTtlMs?: number;
    /** Network timeout in ms for JWKS retrieval. Default 10_000. */
    fetchTimeoutMs?: number;
}
/** Test hook: clear the module JWKS cache. */
export declare function clearJwksCache(): void;
/**
 * Browser-side verification of an attestation token using WebCrypto. Confirms
 * the enclave is a genuine Confidential Space workload before the client sends
 * any encrypted request to it. This is what makes the "we can't peek either"
 * claim checkable by the user.
 */
export declare function verifyAttestationToken(token: string, audience: string, policy?: ClientAttestationPolicy): Promise<Record<string, unknown>>;
/**
 * Claim checks for a signature-validated attestation token. Image digest and
 * project allowlists are mandatory: an empty list rejects the token instead of
 * silently disabling the check.
 */
export declare function assertAttestationClaims(payload: Record<string, unknown>, audience: string, policy: ClientAttestationPolicy): void;
/** Verify the key-attestation carried in a /hello response. */
export declare function verifyHello(hello: EnclaveHello, policy?: ClientAttestationPolicy): Promise<Record<string, unknown>>;
/** Verify the attestation attached to a registration response. */
export declare function verifyRegistrationAttestation(signed: SignedRegistration, policy?: ClientAttestationPolicy): Promise<void>;
