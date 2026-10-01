import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { base58Decode } from "../shared/base58.js";
import { ownershipChallenge } from "../shared/constants.js";
import { bytesToHex, hexToBytes, utf8 } from "../shared/crypto.js";
/**
 * Verify that the supplied signature proves control of the claimed address for
 * this exact identity + nonce. Returns the normalized address on success.
 */
export function verifyOwnership(wallet, context) {
    return verifyWalletSignature(wallet, ownershipChallenge(context));
}
/** Verify a wallet signature over an arbitrary challenge string. */
export function verifyWalletSignature(wallet, message) {
    if (wallet.family === "evm")
        return verifyEvm(wallet, message);
    if (wallet.family === "solana")
        return verifySolana(wallet, message);
    return { ok: false, reason: `unsupported family ${wallet.family}` };
}
function evmPersonalSignHash(message) {
    const prefix = `\x19Ethereum Signed Message:\n${utf8(message).length}`;
    return keccak_256(concat(utf8(prefix), utf8(message)));
}
function verifyEvm(wallet, message) {
    const claimed = wallet.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(claimed)) {
        return { ok: false, reason: "invalid EVM address" };
    }
    let signature;
    try {
        signature = hexToBytes(wallet.signature);
    }
    catch {
        return { ok: false, reason: "invalid signature hex" };
    }
    if (signature.length !== 65)
        return { ok: false, reason: "signature must be 65 bytes" };
    const r = signature.slice(0, 32);
    const s = signature.slice(32, 64);
    let v = signature[64];
    if (v >= 27)
        v -= 27;
    if (v !== 0 && v !== 1)
        return { ok: false, reason: "invalid recovery id" };
    const digest = evmPersonalSignHash(message);
    let publicKey;
    try {
        const sig = secp256k1.Signature.fromCompact(concat(r, s)).addRecoveryBit(v);
        publicKey = sig.recoverPublicKey(digest).toRawBytes(false);
    }
    catch {
        return { ok: false, reason: "signature recovery failed" };
    }
    // Address = last 20 bytes of keccak256(uncompressed pubkey without 0x04).
    const address = `0x${bytesToHex(keccak_256(publicKey.slice(1)).slice(-20))}`;
    if (address.toLowerCase() !== claimed) {
        return { ok: false, reason: "signature does not match claimed address" };
    }
    return { ok: true, address: claimed };
}
function verifySolana(wallet, message) {
    const address = wallet.address;
    let publicKey;
    let signature;
    try {
        publicKey = base58Decode(address);
        signature = base58Decode(wallet.signature);
    }
    catch {
        return { ok: false, reason: "invalid base58 address or signature" };
    }
    if (publicKey.length !== 32)
        return { ok: false, reason: "solana public key must be 32 bytes" };
    if (signature.length !== 64)
        return { ok: false, reason: "solana signature must be 64 bytes" };
    const ok = ed25519.verify(signature, utf8(message), publicKey);
    if (!ok)
        return { ok: false, reason: "ed25519 signature invalid" };
    return { ok: true, address };
}
function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}
