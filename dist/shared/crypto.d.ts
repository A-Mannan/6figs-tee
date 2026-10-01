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
export declare function canonicalJson(value: unknown): string;
/** UTF-8 encode a string. */
export declare function utf8(input: string): Uint8Array;
export declare function bytesToHex(bytes: Uint8Array): string;
export declare function hexToBytes(hex: string): Uint8Array;
/** base64url (no padding) encode. Safe for URLs, JSON, and JWT segments. */
export declare function bytesToBase64url(bytes: Uint8Array): string;
export declare function base64urlToBytes(input: string): Uint8Array;
/** SHA-256 over UTF-8 of the input, returned as lowercase hex. */
export declare function sha256Hex(input: string | Uint8Array): string;
/** SHA-256 over raw bytes. */
export declare function sha256Bytes(input: string | Uint8Array): Uint8Array;
/** HMAC-SHA256, hex output. */
export declare function hmacSha256Hex(key: Uint8Array, message: string): string;
export declare function randomBytes(length: number): Uint8Array;
export declare function randomHex(length: number): string;
/**
 * WebCrypto's `BufferSource` typings reject `Uint8Array<ArrayBufferLike>` on
 * newer TypeScript lib versions. This copies the view into a plain ArrayBuffer
 * so every subtle.* call typechecks and no SharedArrayBuffer can leak in.
 */
export declare function asBufferSource(bytes: Uint8Array): ArrayBuffer;
