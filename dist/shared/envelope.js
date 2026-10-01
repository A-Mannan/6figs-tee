import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { DOMAIN } from "./constants.js";
import { asBufferSource, base64urlToBytes, bytesToBase64url, randomBytes, utf8, } from "./crypto.js";
const INFO = utf8(`aes-256-gcm:${DOMAIN.envelope}`);
const SALT = sha256(utf8(`hkdf-salt:${DOMAIN.envelope}`));
function deriveAesKey(sharedSecret) {
    return hkdf(sha256, sharedSecret, SALT, INFO, 32);
}
/**
 * Encrypt a JSON-serializable payload to an X25519 public key using an
 * ephemeral ECDH exchange and AES-256-GCM. Only the holder of the matching
 * private key (the enclave) can open it.
 */
export async function encryptEnvelope(recipientPublicKey, payload) {
    const ephemeralPriv = x25519.utils.randomPrivateKey();
    const ephemeralPub = x25519.getPublicKey(ephemeralPriv);
    const shared = x25519.getSharedSecret(ephemeralPriv, recipientPublicKey);
    const key = deriveAesKey(shared);
    const iv = randomBytes(12);
    const plaintext = utf8(JSON.stringify(payload));
    const ciphertext = await globalThis.crypto.subtle.encrypt({
        name: "AES-GCM",
        iv: asBufferSource(iv),
        additionalData: asBufferSource(utf8(DOMAIN.envelope)),
        tagLength: 128,
    }, await globalThis.crypto.subtle.importKey("raw", asBufferSource(key), "AES-GCM", false, ["encrypt"]), asBufferSource(plaintext));
    return {
        v: 1,
        epk: bytesToBase64url(ephemeralPub),
        iv: bytesToBase64url(iv),
        ct: bytesToBase64url(new Uint8Array(ciphertext)),
    };
}
/**
 * Decrypt an envelope with the matching X25519 private key. Throws when the
 * ciphertext, IV, additional data, or key are wrong — AES-GCM authenticates.
 * The caller owns payload shape validation.
 */
export async function decryptEnvelope(privateKey, envelope) {
    if (envelope.v !== 1)
        throw new Error("unsupported envelope version");
    const ephemeralPub = base64urlToBytes(envelope.epk);
    const iv = base64urlToBytes(envelope.iv);
    const ct = base64urlToBytes(envelope.ct);
    if (ephemeralPub.length !== 32)
        throw new Error("bad ephemeral key length");
    if (iv.length !== 12)
        throw new Error("bad iv length");
    const shared = x25519.getSharedSecret(privateKey, ephemeralPub);
    const key = deriveAesKey(shared);
    let plaintext;
    try {
        plaintext = await globalThis.crypto.subtle.decrypt({
            name: "AES-GCM",
            iv: asBufferSource(iv),
            additionalData: asBufferSource(utf8(DOMAIN.envelope)),
            tagLength: 128,
        }, await globalThis.crypto.subtle.importKey("raw", asBufferSource(key), "AES-GCM", false, ["decrypt"]), asBufferSource(ct));
    }
    catch {
        throw new Error("envelope decryption failed");
    }
    const parsed = JSON.parse(new TextDecoder().decode(plaintext));
    if (!parsed || typeof parsed !== "object") {
        throw new Error("malformed envelope payload");
    }
    return parsed;
}
