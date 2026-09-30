import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson,
  bytesToBase64url,
  base64urlToBytes,
  hexToBytes,
  bytesToHex,
  sha256Hex,
} from "../src/shared/crypto.ts";
import { encryptEnvelope, decryptEnvelope } from "../src/shared/envelope.ts";
import {
  generateEnclaveKeys,
  bindingNonce,
  verifyResultSignature,
  signResult,
  exportPublicKeys,
} from "../src/shared/attestation.ts";
import { base58Encode, base58Decode } from "../src/shared/base58.ts";

test("canonicalJson sorts keys and omits undefined", () => {
  const a = canonicalJson({ b: 1, a: 2, c: undefined });
  assert.equal(a, '{"a":2,"b":1}');
  const nested = canonicalJson({ z: [3, { y: 1, x: 2 }], a: "s" });
  assert.equal(nested, '{"a":"s","z":[3,{"x":2,"y":1}]}');
});

test("canonicalJson serializes bigint as decimal string", () => {
  assert.equal(canonicalJson({ v: 10n }), '{"v":"10"}');
});

test("base64url round-trips arbitrary bytes", () => {
  for (let i = 0; i < 64; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(i));
    const encoded = bytesToBase64url(bytes);
    assert.deepEqual(base64urlToBytes(encoded), bytes);
  }
});

test("hex round-trips", () => {
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  assert.deepEqual(hexToBytes(bytesToHex(bytes)), bytes);
});

test("envelope encrypts to the recipient and rejects a wrong key", async () => {
  const recipient = generateEnclaveKeys();
  const attacker = generateEnclaveKeys();
  const payload = { request: { hello: "world", n: 5 } } as never;
  const envelope = await encryptEnvelope(recipient.encryptionPublic, payload);
  const opened = await decryptEnvelope(recipient.encryptionPrivate, envelope);
  assert.deepEqual(opened, payload);
  await assert.rejects(() => decryptEnvelope(attacker.encryptionPrivate, envelope));
});

test("envelope rejects tampered ciphertext", async () => {
  const keys = generateEnclaveKeys();
  const envelope = await encryptEnvelope(keys.encryptionPublic, {
    request: { a: 1 } as never,
  });
  const tampered = { ...envelope, ct: envelope.ct.slice(0, -2) + "AA" };
  await assert.rejects(() => decryptEnvelope(keys.encryptionPrivate, tampered));
});

test("enclave result signatures verify and reject tampering", () => {
  const keys = generateEnclaveKeys();
  const body = canonicalJson({ tier: 2, id: "abc" });
  const signature = signResult(keys, body);
  const { signingPublicKey } = exportPublicKeys(keys);
  assert.equal(verifyResultSignature(signingPublicKey, body, signature), true);
  assert.equal(verifyResultSignature(signingPublicKey, `${body} `, signature), false);
});

test("binding nonce is deterministic and key/payload specific", () => {
  const keys = generateEnclaveKeys();
  const other = generateEnclaveKeys();
  const n1 = bindingNonce(keys.signingPublic, "payload");
  const n2 = bindingNonce(keys.signingPublic, "payload");
  const n3 = bindingNonce(keys.signingPublic, "other");
  const n4 = bindingNonce(other.signingPublic, "payload");
  assert.equal(n1, n2);
  assert.notEqual(n1, n3);
  assert.notEqual(n1, n4);
});

test("base58 round-trips including leading zeros", () => {
  for (const input of [
    new Uint8Array([0, 0, 1, 2, 3, 255]),
    crypto.getRandomValues(new Uint8Array(32)),
    new Uint8Array([0]),
  ]) {
    assert.deepEqual(base58Decode(base58Encode(input)), input);
  }
});

test("sha256Hex is stable", () => {
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});