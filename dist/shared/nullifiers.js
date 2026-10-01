import { DOMAIN } from "./constants.js";
import { hmacSha256Hex, sha256Hex } from "./crypto.js";
/** wallet_nullifier = SHA-256(domain || family || normalizedAddress). One-way. */
export function walletNullifier(family, address) {
    const normalized = family === "evm" ? address.toLowerCase() : address;
    return sha256Hex(`${DOMAIN.wallet}|${family}|${normalized}`);
}
export const LEGACY_NULLIFIER_SCHEME = {
    name: "legacy-v1",
    walletNullifier,
};
/**
 * Keyed scheme. The separate v2 domain tag keeps the two formulas from ever
 * colliding, even if the key leaks.
 */
export function keyedNullifierScheme(key) {
    const keyCopy = key.slice();
    return {
        name: "keyed-v1",
        walletNullifier(family, address) {
            const normalized = family === "evm" ? address.toLowerCase() : address;
            return hmacSha256Hex(keyCopy, `${DOMAIN.walletV2}|${family}|${normalized}`);
        },
    };
}
/**
 * identity_nullifier = SHA-256(domain || sorted family:walletNullifier list).
 * The account *is* the wallet set: no client-held secret exists, so recovery is
 * exactly "sign again with the same wallets". Sets are order-independent, and
 * any change to membership produces a different identity. Scheme-agnostic: it
 * commits to whatever nullifier strings it is given.
 */
export function walletSetNullifier(entries) {
    const sorted = entries.map((entry) => `${entry.family}:${entry.walletNullifier}`).sort();
    return sha256Hex(`${DOMAIN.identity}|${sorted.join("|")}`);
}
export function walletEntriesFromAddresses(wallets, scheme = LEGACY_NULLIFIER_SCHEME) {
    return wallets.map((wallet) => ({
        walletNullifier: scheme.walletNullifier(wallet.family, wallet.address),
        family: wallet.family,
        chainId: wallet.chainId ?? 0,
        ...(wallet.label ? { label: wallet.label } : {}),
    }));
}
