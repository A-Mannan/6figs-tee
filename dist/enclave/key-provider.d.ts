import type { AttestationProvider } from "./attestation-provider.ts";
export type EscrowKeyProviderKind = "kms" | "env" | "none";
export interface LoadedEscrowKey {
    /** null when no persistent material is configured (provider "none"). */
    privateKey: Uint8Array | null;
    provider: EscrowKeyProviderKind;
    /** KMS key resource that released the key, when applicable. */
    keyId?: string;
}
/**
 * Owns how the long-lived escrow private key enters the enclave. The key is
 * only ever a raw 32-byte X25519 scalar; providers differ in who can release
 * it. Rechecks and wallet additions need persistent material; without it they
 * fail closed.
 */
export interface EscrowKeyProvider {
    readonly kind: EscrowKeyProviderKind;
    load(): Promise<LoadedEscrowKey>;
}
export declare class EnvEscrowKeyProvider implements EscrowKeyProvider {
    readonly kind: "env";
    private readonly raw;
    constructor(raw: string);
    load(): Promise<LoadedEscrowKey>;
}
export declare class NoneEscrowKeyProvider implements EscrowKeyProvider {
    readonly kind: "none";
    load(): Promise<LoadedEscrowKey>;
}
export interface GcpKmsEscrowKeyProviderOptions {
    /** Cloud KMS resource name: projects/P/locations/L/keyRings/R/cryptoKeys/K. */
    kmsKey: string;
    /** Ciphertext of the 32-byte escrow private key, base64 (standard). */
    wrappedKey: Uint8Array;
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
    load(): Promise<LoadedEscrowKey>;
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
