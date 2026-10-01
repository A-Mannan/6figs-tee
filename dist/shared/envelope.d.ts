import type { EnvelopePayload, SignedEnvelope } from "./types.ts";
/**
 * Encrypt a JSON-serializable payload to an X25519 public key using an
 * ephemeral ECDH exchange and AES-256-GCM. Only the holder of the matching
 * private key (the enclave) can open it.
 */
export declare function encryptEnvelope<T>(recipientPublicKey: Uint8Array, payload: T): Promise<SignedEnvelope>;
/**
 * Decrypt an envelope with the matching X25519 private key. Throws when the
 * ciphertext, IV, additional data, or key are wrong — AES-GCM authenticates.
 * The caller owns payload shape validation.
 */
export declare function decryptEnvelope<T = EnvelopePayload>(privateKey: Uint8Array, envelope: SignedEnvelope): Promise<T>;
