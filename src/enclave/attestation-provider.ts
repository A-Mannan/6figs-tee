import { request as httpRequest } from "node:http";
import { keyAttestationNonce } from "../shared/attestation.ts";
import { bytesToBase64url, sha256Hex, utf8 } from "../shared/crypto.ts";
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

const LAUNCHER_SOCKET = "/run/container_launcher/teeserver.sock";

/** Real provider: talks to the Confidential Space launcher over IPC. */
export class ConfidentialSpaceAttestationProvider implements AttestationProvider {
  readonly kind = "confidential-space" as const;
  readonly projectId: string;
  readonly zone: string;
  readonly instanceId: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.projectId = env.SIXFIGS_GCP_PROJECT ?? env.GOOGLE_CLOUD_PROJECT ?? "unknown";
    this.zone = env.SIXFIGS_GCP_ZONE ?? "unknown";
    this.instanceId = env.SIXFIGS_GCP_INSTANCE ?? "unknown";
  }

  async getToken(options: AttestationTokenOptions): Promise<string> {
    const body = JSON.stringify({
      audience: options.audience,
      token_type: options.tokenType,
      nonces: options.nonces,
    });

    return new Promise<string>((resolve, reject) => {
      const req = httpRequest(
        {
          socketPath: LAUNCHER_SOCKET,
          path: "/v1/token",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
          timeout: 10_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
              reject(
                new Error(
                  `attestation launcher returned ${res.statusCode}: ${text.slice(0, 200)}`,
                ),
              );
              return;
            }
            resolve(text.trim());
          });
        },
      );
      req.on("timeout", () => {
        req.destroy(new Error("attestation launcher request timed out"));
      });
      req.on("error", reject);
      req.end(body);
    });
  }

  async buildKeyAttestation(params: {
    signingPublicKey: Uint8Array;
    encryptionPublicKey: Uint8Array;
    escrowPublicKey: Uint8Array;
  }): Promise<EnclaveKeyAttestation> {
    const nonce = keyAttestationNonce(
      params.signingPublicKey,
      params.encryptionPublicKey,
      params.escrowPublicKey,
    );
    const token = await this.getToken({
      audience: "6figs-enclave-key",
      nonces: [nonce],
      tokenType: "OIDC",
    });
    return {
      v: 1,
      keyAlgorithm: "ed25519",
      publicKey: bytesToBase64url(params.signingPublicKey),
      createdAt: Date.now(),
      attestationToken: token,
      keyNonce: nonce,
      provider: "confidential-space",
      projectId: this.projectId,
      zone: this.zone,
      keyId: sha256Hex(params.signingPublicKey),
    };
  }
}

/**
 * Mock provider for `SIXFIGS_MOCK_ATTESTATION=1`. Emits a JWT-shaped token
 * whose payload mirrors the real claim names. Never use in production; the
 * verifier only accepts the "mock" issuer when explicitly told to.
 */
export class MockAttestationProvider implements AttestationProvider {
  readonly kind = "mock" as const;
  readonly projectId: string;
  readonly zone: string;
  readonly instanceId: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.projectId = env.SIXFIGS_GCP_PROJECT ?? "mock-project";
    this.zone = env.SIXFIGS_GCP_ZONE ?? "mock-zone-a";
    this.instanceId = env.SIXFIGS_GCP_INSTANCE ?? "mock-instance";
  }

  async getToken(options: AttestationTokenOptions): Promise<string> {
    const header = { alg: "none", typ: "JWT" };
    const payload = {
      aud: options.audience,
      dbgstat: "disabled-since-boot",
      eat_nonce: options.nonces,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: "https://mock.6figs.local/attestation",
      swname: "CONFIDENTIAL_SPACE",
      swversion: ["MOCK"],
      hwmodel: "GCP_AMD_SEV",
      secboot: true,
      submods: {
        container: {
          image_digest: `sha256:${sha256Hex("6figs-mock-image")}`,
          image_reference: "mock/6figs-enclave:dev",
        },
        gce: {
          instance_id: this.instanceId,
          instance_name: this.instanceId,
          project_id: this.projectId,
          zone: this.zone,
        },
        confidential_space: {
          support_attributes: ["USABLE"],
          monitoring_enabled: { memory: false },
        },
      },
    };
    const signingInput = `${bytesToBase64url(
      utf8(JSON.stringify(header)),
    )}.${bytesToBase64url(utf8(JSON.stringify(payload)))}`;
    const signature = bytesToBase64url(utf8(`mock-signature:${sha256Hex(signingInput)}`));
    return `${signingInput}.${signature}`;
  }

  async buildKeyAttestation(params: {
    signingPublicKey: Uint8Array;
    encryptionPublicKey: Uint8Array;
    escrowPublicKey: Uint8Array;
  }): Promise<EnclaveKeyAttestation> {
    const nonce = keyAttestationNonce(
      params.signingPublicKey,
      params.encryptionPublicKey,
      params.escrowPublicKey,
    );
    const token = await this.getToken({
      audience: "6figs-enclave-key",
      nonces: [nonce],
      tokenType: "OIDC",
    });
    return {
      v: 1,
      keyAlgorithm: "ed25519",
      publicKey: bytesToBase64url(params.signingPublicKey),
      createdAt: Date.now(),
      attestationToken: token,
      keyNonce: nonce,
      provider: "mock",
      projectId: this.projectId,
      zone: this.zone,
      keyId: sha256Hex(params.signingPublicKey),
    };
  }
}

