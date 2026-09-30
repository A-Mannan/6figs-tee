import { ed25519, x25519 } from "@noble/curves/ed25519";
import { DOMAIN } from "./constants.ts";
import { base64urlToBytes, bytesToBase64url, sha256Hex, utf8 } from "./crypto.ts";

/**
 * The enclave owns two independent keys:
 *  - an Ed25519 key that signs registration results (long-lived for the VM run)
 *  - an X25519 key that decrypts client request envelopes
 * Both are ephemeral to the enclave boot; a key is proven to live inside a
 * genuine enclave by the Confidential Space attestation token binding
 * sha256(signingPubkey || encryptionPubkey).
 */
export interface EnclaveKeys {
  signingPrivate: Uint8Array;
  signingPublic: Uint8Array;
  encryptionPrivate: Uint8Array;
  encryptionPublic: Uint8Array;
}

export function generateEnclaveKeys(): EnclaveKeys {
  const signingPrivate = ed25519.utils.randomPrivateKey();
  const signingPublic = ed25519.getPublicKey(signingPrivate);
  const encryptionPrivate = x25519.utils.randomPrivateKey();
  const encryptionPublic = x25519.getPublicKey(encryptionPrivate);
  return { signingPrivate, signingPublic, encryptionPrivate, encryptionPublic };
}

export function exportPublicKeys(keys: EnclaveKeys): {
  signingPublicKey: string;
  encryptionPublicKey: string;
  keyId: string;
} {
  const signingPublicKey = bytesToBase64url(keys.signingPublic);
  return {
    signingPublicKey,
    encryptionPublicKey: bytesToBase64url(keys.encryptionPublic),
    keyId: sha256Hex(keys.signingPublic),
  };
}

export function signResult(keys: EnclaveKeys, canonicalBody: string): string {
  return bytesToBase64url(ed25519.sign(utf8(canonicalBody), keys.signingPrivate));
}

export function verifyResultSignature(
  signingPublicKey: string,
  canonicalBody: string,
  signature: string,
): boolean {
  try {
    return ed25519.verify(
      base64urlToBytes(signature),
      utf8(canonicalBody),
      base64urlToBytes(signingPublicKey),
    );
  } catch {
    return false;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * The nonce passed to the attestation token. It binds a specific public key to
 * a specific payload hash so the token cannot be replayed for a different key
 * or a doctored result.
 */
export function bindingNonce(publicKey: Uint8Array, payload: string): string {
  return sha256Hex(concat(publicKey, utf8(`${DOMAIN.nonce}:${payload}`)));
}

export function keyId(publicKey: Uint8Array): string {
  return sha256Hex(publicKey);
}

/**
 * Nonce for the /hello key attestation. Covers both public keys so a token
 * cannot be relayed with a substituted encryption key.
 */
export function keyAttestationNonce(
  signingPublicKey: Uint8Array,
  encryptionPublicKey: Uint8Array,
): string {
  return sha256Hex(concat(signingPublicKey, encryptionPublicKey));
}

