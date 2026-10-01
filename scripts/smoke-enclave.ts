/**
 * Dev smoke test against a live enclave VM. Generates a throwaway wallet,
 * runs the two-phase registration against the real attestation path, and
 * verifies the signed result. Usage:
 *
 *   node --experimental-strip-types scripts/smoke-enclave.ts <url> <image-digest> <gcp-project> [solana|evm]
 */
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { RegistrationClient } from "../src/client/register.ts";
import { AttestationVerifier } from "../src/verifier/index.ts";
import { base58Encode } from "../src/shared/base58.ts";
import { bytesToHex, utf8 } from "../src/shared/crypto.ts";

const [url, digest, project, familyArg] = process.argv.slice(2);
if (!url || !digest || !project) {
  console.error("usage: smoke-enclave.ts <url> <image-digest> <gcp-project> [solana|evm]");
  process.exit(2);
}
const family = familyArg === "evm" ? "evm" : "solana";

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function wallet(): { descriptor: { family: "evm" | "solana"; chainId: number; address: string }; sign: (message: string) => string } {
  if (family === "evm") {
    const privateKey = secp256k1.utils.randomPrivateKey();
    const publicKey = secp256k1.getPublicKey(privateKey, false);
    const address = `0x${bytesToHex(keccak_256(publicKey.slice(1)).slice(-20))}`;
    return {
      descriptor: { family: "evm", chainId: 11155111, address },
      sign: (message: string) => {
        const prefix = `\x19Ethereum Signed Message:\n${utf8(message).length}`;
        const digest = keccak_256(concat(utf8(prefix), utf8(message)));
        const signature = secp256k1.sign(digest, privateKey);
        return bytesToHex(concat(signature.toCompactRawBytes(), new Uint8Array([signature.recovery! + 27])));
      },
    };
  }
  const privateKey = ed25519.utils.randomPrivateKey();
  const address = base58Encode(ed25519.getPublicKey(privateKey));
  return {
    descriptor: { family: "solana", chainId: 0, address },
    sign: (message: string) => base58Encode(ed25519.sign(utf8(message), privateKey)),
  };
}

const policy = { allowedImageDigests: [digest], allowedProjects: [project] };
const client = new RegistrationClient({ enclaveUrl: url, policy });

const hello = await client.hello();
console.log("hello ok:", { scheme: hello.nullifierScheme, provider: hello.provider });

const { descriptor, sign } = wallet();
const prepared = client.prepare({ wallets: [descriptor], disclosure: "hidden" });
const result = await client.submit({
  prepared,
  signatures: { [`${descriptor.family}:${descriptor.address.toLowerCase()}`]: sign(prepared.message) },
});

const verifier = new AttestationVerifier({
  audience: "6figs-registration",
  policy: {
    ...policy,
    allowedNullifierSchemes: [hello.nullifierScheme],
  },
});
const body = await verifier.verifyRegistration(result, { expectedNonce: prepared.nonce });
console.log("registration ok:", {
  family,
  scheme: hello.nullifierScheme,
  tier: body.tier,
  band: body.portfolioBand,
  stableBps: body.stableBps,
  policyVersion: body.policyVersion,
  walletCount: body.walletNullifiers.length,
});