import { sha256 } from "@noble/hashes/sha256";
import { hmac } from "@noble/hashes/hmac";
import { utf8ToBytes } from "@noble/hashes/utils";
/**
 * Deterministic JSON serialization used for every signed structure and every
 * hash input. Rules mirror the RFC 8785 subset we actually need:
 *  - object keys sorted lexicographically by UTF-16 code unit
 *  - no insignificant whitespace
 *  - undefined-valued keys omitted; numbers must be finite integers or floats
 *  - bigints serialized as decimal strings (never JSON native)
 *
 * Both the enclave and the verifier use this so signatures cannot be
 * "re-encoded" into a different byte string.
 */
export function canonicalJson(value) {
    return serialize(value);
}
function serialize(value) {
    if (value === null)
        return "null";
    if (value === undefined)
        return "null";
    const t = typeof value;
    if (t === "boolean")
        return value ? "true" : "false";
    if (t === "number") {
        if (!Number.isFinite(value)) {
            throw new Error("canonicalJson: non-finite number");
        }
        return JSON.stringify(value);
    }
    if (t === "bigint") {
        return JSON.stringify(value.toString());
    }
    if (t === "string")
        return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map((v) => serialize(v)).join(",")}]`;
    }
    if (t === "object") {
        const obj = value;
        const keys = Object.keys(obj)
            .filter((k) => obj[k] !== undefined)
            .sort();
        const parts = keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`);
        return `{${parts.join(",")}}`;
    }
    throw new Error(`canonicalJson: unsupported type ${t}`);
}
/** UTF-8 encode a string. */
export function utf8(input) {
    return utf8ToBytes(input);
}
export function bytesToHex(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
        out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
}
export function hexToBytes(hex) {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0)
        throw new Error("hexToBytes: odd length");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(byte))
            throw new Error("hexToBytes: invalid hex");
        out[i] = byte;
    }
    return out;
}
/** base64url (no padding) encode. Safe for URLs, JSON, and JWT segments. */
export function bytesToBase64url(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]);
    const b64 = typeof btoa === "function"
        ? btoa(binary)
        : Buffer.from(bytes).toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function base64urlToBytes(input) {
    const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    if (typeof atob === "function") {
        const binary = atob(padded);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++)
            out[i] = binary.charCodeAt(i);
        return out;
    }
    return new Uint8Array(Buffer.from(padded, "base64"));
}
/** SHA-256 over UTF-8 of the input, returned as lowercase hex. */
export function sha256Hex(input) {
    const bytes = typeof input === "string" ? utf8(input) : input;
    return bytesToHex(sha256(bytes));
}
/** SHA-256 over raw bytes. */
export function sha256Bytes(input) {
    const bytes = typeof input === "string" ? utf8(input) : input;
    return sha256(bytes);
}
/** HMAC-SHA256, hex output. */
export function hmacSha256Hex(key, message) {
    return bytesToHex(hmac(sha256, key, utf8(message)));
}
export function randomBytes(length) {
    const out = new Uint8Array(length);
    globalThis.crypto.getRandomValues(out);
    return out;
}
export function randomHex(length) {
    return bytesToHex(randomBytes(length));
}
/**
 * WebCrypto's `BufferSource` typings reject `Uint8Array<ArrayBufferLike>` on
 * newer TypeScript lib versions. This copies the view into a plain ArrayBuffer
 * so every subtle.* call typechecks and no SharedArrayBuffer can leak in.
 */
export function asBufferSource(bytes) {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
}
