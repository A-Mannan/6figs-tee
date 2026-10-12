/**
 * Live verification of TIER 0 admission against the dev enclave
 * (https://tee.6figs.xyz, real Confidential Space attestation, dev chains on).
 *
 * A freshly generated wallet holds nothing on devnet, so the enclave must
 * assign tier 0 with the current label/band — the exact sub-$100k path this
 * change admits. The signed result is then verified with the backend's own
 * verifier config, proving the backend will accept it before persistence.
 *
 * Run after each image rotation (pass the new digest):
 *   SIXFIGS_PROOF_DIGEST=sha256:<new> \
 *     node --experimental-strip-types scripts/tier0-proof.ts
 * The expected policy version always comes from this repo's shared constants,
 * so the script also proves the deployed enclave runs this code.
 *
 * Nothing is stored anywhere: the proof dies with this process.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { utf8 } from "../src/shared/crypto.ts";
import { POLICY_VERSION } from "../src/shared/constants.ts";
import { RegistrationClient } from "../src/client/register.ts";
import { AttestationVerifier } from "../src/verifier/index.ts";
import assert from "node:assert/strict";

const ENCLAVE = process.env.SIXFIGS_PROOF_ENCLAVE ?? "https://tee.6figs.xyz";
const DIGEST = process.env.SIXFIGS_PROOF_DIGEST ?? "sha256:656d1a9630717d8557ef5d3d1ba18859c38eaa736bbb76df5a0350648da2aa3d";
const PROJECT = process.env.SIXFIGS_PROOF_PROJECT ?? "sixfigs";
const POLICY = POLICY_VERSION;

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const privateKey = secp256k1.utils.randomPrivateKey();
const publicKey = secp256k1.getPublicKey(privateKey, false);
const address = `0x${Buffer.from(keccak_256(publicKey.slice(1)).slice(-20)).toString("hex")}`;

function signMessage(message: string): string {
  const prefix = `\x19Ethereum Signed Message:\n${utf8(message).length}`;
  const digest = keccak_256(concat(utf8(prefix), utf8(message)));
  const sig = secp256k1.sign(digest, privateKey);
  return Buffer.from(
    concat(sig.toCompactRawBytes(), new Uint8Array([sig.recovery! + 27])),
  ).toString("hex");
}

const client = new RegistrationClient({
  enclaveUrl: ENCLAVE,
  policy: { allowedImageDigests: [DIGEST], allowedProjects: [PROJECT] },
  fetchImpl: fetch,
});

console.log("==> fresh wallet:", address);
console.log("==> prepare (ownership challenge)");
const prepared = client.prepare({
  wallets: [{ family: "evm", chainId: 1, address }],
  disclosure: "hidden",
});

console.log("==> submit (attestation verified in-browser-style, then enclave signs)");
const signed = await client.submit({
  prepared,
  signatures: { [`evm:${address.toLowerCase()}`]: signMessage(prepared.message) },
});

console.log("    tier          :", signed.body.tier);
console.log("    tierLabel     :", signed.body.tierLabel);
console.log("    band          :", signed.body.portfolioBand);
console.log("    topAssets     :", JSON.stringify(signed.body.topAssets));
console.log("    policyVersion :", signed.body.policyVersion);
assert.equal(signed.body.tier, 0);
assert.equal(signed.body.tierLabel, "$0+");
assert.equal(signed.body.portfolioBand, "<10");
assert.deepEqual(signed.body.topAssets, []);
assert.equal(signed.body.policyVersion, POLICY);

console.log("==> backend-side verification (backend policy mirror)");
const verifier = new AttestationVerifier({
  audience: "6figs-registration",
  policy: {
    allowedImageDigests: [DIGEST],
    allowedProjects: [PROJECT],
    allowedNullifierSchemes: ["keyed-v1"],
  },
});
const body = await verifier.verifyRegistration(signed, {
  expectedNonce: prepared.nonce,
  expectedPolicyVersion: POLICY,
});
assert.equal(body.tier, 0);
assert.equal(body.identityNullifier.length, 64);

console.log("\nTIER 0 PROOF OK — fresh wallet admitted as tier 0 through the live enclave.");
