import { ed25519, x25519 } from "@noble/curves/ed25519";
import { DOMAIN } from "./constants.js";
import { base64urlToBytes, bytesToBase64url, sha256Hex, utf8 } from "./crypto.js";
export function generateEnclaveKeys(escrowPrivate) {
    const signingPrivate = ed25519.utils.randomPrivateKey();
    const signingPublic = ed25519.getPublicKey(signingPrivate);
    const encryptionPrivate = x25519.utils.randomPrivateKey();
    const encryptionPublic = x25519.getPublicKey(encryptionPrivate);
    const escrow = escrowPrivate ?? x25519.utils.randomPrivateKey();
    return {
        signingPrivate,
        signingPublic,
        encryptionPrivate,
        encryptionPublic,
        escrowPrivate: escrow,
        escrowPublic: x25519.getPublicKey(escrow),
    };
}
export function exportPublicKeys(keys) {
    const signingPublicKey = bytesToBase64url(keys.signingPublic);
    return {
        signingPublicKey,
        encryptionPublicKey: bytesToBase64url(keys.encryptionPublic),
        escrowPublicKey: bytesToBase64url(keys.escrowPublic),
        keyId: sha256Hex(keys.signingPublic),
    };
}
export function signResult(keys, canonicalBody) {
    return bytesToBase64url(ed25519.sign(utf8(canonicalBody), keys.signingPrivate));
}
export function verifyResultSignature(signingPublicKey, canonicalBody, signature) {
    try {
        return ed25519.verify(base64urlToBytes(signature), utf8(canonicalBody), base64urlToBytes(signingPublicKey));
    }
    catch {
        return false;
    }
}
function concat(a, b) {
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
export function bindingNonce(publicKey, payload) {
    return sha256Hex(concat(publicKey, utf8(`${DOMAIN.nonce}:${payload}`)));
}
export function keyId(publicKey) {
    return sha256Hex(publicKey);
}
/**
 * Nonce for the /hello key attestation. Covers all three public keys so a
 * token cannot be relayed with a substituted encryption or escrow key.
 */
export function keyAttestationNonce(signingPublicKey, encryptionPublicKey, escrowPublicKey) {
    return sha256Hex(concat(concat(signingPublicKey, encryptionPublicKey), escrowPublicKey));
}
