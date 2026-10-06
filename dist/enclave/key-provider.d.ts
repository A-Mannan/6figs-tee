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
export declare class EnvEscrowKeyProvider implements EscrowKeyProvider {
    readonly kind: "env";
    private readonly raw;
    constructor(raw: string);
    load(): Promise<LoadedSecrets>;
}
export declare class NoneEscrowKeyProvider implements EscrowKeyProvider {
    readonly kind: "none";
    load(): Promise<LoadedSecrets>;
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
/**
 * Releases the escrow key through Cloud KMS. The only credential is the
 * Confidential Space attestation token: it is exchanged at the GCP Security
 * Token Service for a federated token, optionally impersonates a service
 * account, and the resulting short-lived access token calls KMS. A stolen
 * wrapped key is useless without a workload the KMS IAM policy recognizes.
 */
export declare class GcpKmsEscrowKeyProvider implements EscrowKeyProvider {
    readonly kind: "kms";
    private readonly options;
    private readonly fetchImpl;
    constructor(options: GcpKmsEscrowKeyProviderOptions);
    load(): Promise<LoadedSecrets>;
    private exchange;
    private impersonate;
    private decrypt;
}
/**
 * Boot-time provider selection. KMS wins when configured; the environment key
 * is a dev/staging fallback that production refuses unless the operator sets
 * the explicit override; otherwise there is no persistent escrow material and
 * rechecks/additions are disabled.
 */
export declare function selectEscrowKeyProvider(attestation: AttestationProvider, env?: NodeJS.ProcessEnv): EscrowKeyProvider;
