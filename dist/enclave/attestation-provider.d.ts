import type { EnclaveKeyAttestation } from "../shared/types.ts";
/**
 * Abstraction over the Confidential Space launcher. The real provider reads the
 * attestation token over the launcher's unix domain socket; the mock provider
 * fabricates a structurally similar token for local development and tests.
 */
export interface AttestationTokenOptions {
    audience: string;
    nonces: string[];
    tokenType: "OIDC" | "PKI" | "AWS_PRINCIPALTAGS";
}
export interface AttestationProvider {
    readonly kind: "confidential-space" | "mock";
    readonly projectId: string;
    readonly zone: string;
    readonly instanceId: string;
    getToken(options: AttestationTokenOptions): Promise<string>;
    buildKeyAttestation(params: {
        signingPublicKey: Uint8Array;
        encryptionPublicKey: Uint8Array;
        escrowPublicKey: Uint8Array;
    }): Promise<EnclaveKeyAttestation>;
}
/** Real provider: talks to the Confidential Space launcher over IPC. */
export declare class ConfidentialSpaceAttestationProvider implements AttestationProvider {
    readonly kind: "confidential-space";
    readonly projectId: string;
    readonly zone: string;
    readonly instanceId: string;
    constructor(env?: NodeJS.ProcessEnv);
    getToken(options: AttestationTokenOptions): Promise<string>;
    buildKeyAttestation(params: {
        signingPublicKey: Uint8Array;
        encryptionPublicKey: Uint8Array;
        escrowPublicKey: Uint8Array;
    }): Promise<EnclaveKeyAttestation>;
}
/**
 * Mock provider for `SIXFIGS_MOCK_ATTESTATION=1`. Emits a JWT-shaped token
 * whose payload mirrors the real claim names. Never use in production; the
 * verifier only accepts the "mock" issuer when explicitly told to.
 */
export declare class MockAttestationProvider implements AttestationProvider {
    readonly kind: "mock";
    readonly projectId: string;
    readonly zone: string;
    readonly instanceId: string;
    constructor(env?: NodeJS.ProcessEnv);
    getToken(options: AttestationTokenOptions): Promise<string>;
    buildKeyAttestation(params: {
        signingPublicKey: Uint8Array;
        encryptionPublicKey: Uint8Array;
        escrowPublicKey: Uint8Array;
    }): Promise<EnclaveKeyAttestation>;
}
