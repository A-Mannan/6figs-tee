import type { EnclaveHello, RegistrationResultBody, SignedRegistration } from "../shared/types.ts";
export { RegistrationService, RegistrationConflict, type RegistrationServiceOptions, } from "./service.ts";
export { InMemoryNullifierStore, recordFromBody, type NullifierStore, type StoredRegistration, } from "./store.ts";
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
    /** Escrow key providers the backend will accept, e.g. ["kms"]. */
    requiredEscrowKeyProviders?: string[];
    /** Whether debug images (dbgstat === "enabled") are acceptable. */
    allowDebug?: boolean;
}
export interface VerifierConfig {
    audience: string;
    policy: EnclavePolicy;
    /** Accept tokens issued by the mock provider. Never enable in production. */
    allowMock?: boolean;
    /** Override the JWKS document (tests / offline verification). */
    jwks?: {
        keys: Array<Record<string, unknown>>;
    };
    /** Pin the PKI root certificate PEM. Falls back to the HTTPS endpoint. */
    pkiRootPem?: string;
    /** Clock skew tolerance in ms. Default 60s. */
    clockSkewMs?: number;
}
export declare class VerificationError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare class AttestationVerifier {
    private jwksCache;
    private rootCache;
    private readonly config;
    constructor(config: VerifierConfig);
    /**
     * Full verification of a signed registration. Returns the trusted body.
     * Throws VerificationError on any failed check — callers should fail closed.
     */
    verifyRegistration(signed: SignedRegistration, options?: {
        expectedNonce?: string;
        expectedPolicyVersion?: string;
    }): Promise<RegistrationResultBody>;
    /** Verify the /hello key attestation binds the advertised signing key. */
    verifyHello(hello: EnclaveHello): Promise<void>;
    /**
     * Addition results carry exactly three extra fields. They are accepted only
     * together, must reference an identity that actually changed, and the added
     * entries must be part of the resulting wallet set. The backend still checks
     * the transition against its stored bindings; this is the shape gate.
     */
    private checkAddition;
    private expectedResultNonce;
    private verifyToken;
    private requireNonce;
    private checkExpiry;
    private checkTier;
    /**
     * Disclosed fields are product-visible, so they are shape-checked strictly:
     * symbols are short uppercase alphanumerics ([A-Z0-9], 1–10) and wallet
     * labels are printable ASCII capped at 32. An address can never pass for a
     * label because ':'/'x' … base58/hex strings exceed 32 chars or contain
     * characters outside the set.
     */
    private checkDisclosures;
    private loadJwks;
    private loadPkiRoot;
}
/**
 * Claim checks for a signature-validated attestation token. The image digest
 * and project allowlists are mandatory: an empty list rejects every real token
 * instead of silently disabling the check.
 */
export declare function checkTokenClaims(payload: Record<string, unknown>, config: {
    audience: string;
    policy: EnclavePolicy;
    clockSkewMs?: number;
}): void;
