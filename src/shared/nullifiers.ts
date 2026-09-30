import { DOMAIN } from "./constants.ts";
import { hmacSha256Hex, sha256Hex } from "./crypto.ts";
import type { WalletNullifierEntry } from "./types.ts";

export type NullifierSchemeName = "legacy-v1" | "keyed-v1";

/**
 * How wallet nullifiers are derived. The legacy scheme is plain SHA-256 and is
 * computable offline by anyone holding a candidate address; the keyed scheme
 * needs the enclave's secret key. Both are deterministic, so deduplication and
 * the wallet-set identity work identically under either.
 */
export interface NullifierScheme {
  readonly name: NullifierSchemeName;
  walletNullifier(family: string, address: string): string;
}

/** wallet_nullifier = SHA-256(domain || family || normalizedAddress). One-way. */
export function walletNullifier(family: string, address: string): string {
  const normalized = family === "evm" ? address.toLowerCase() : address;
  return sha256Hex(`${DOMAIN.wallet}|${family}|${normalized}`);
}

export const LEGACY_NULLIFIER_SCHEME: NullifierScheme = {
  name: "legacy-v1",
  walletNullifier,
};

/**
 * Keyed scheme. The separate v2 domain tag keeps the two formulas from ever
 * colliding, even if the key leaks.
 */
export function keyedNullifierScheme(key: Uint8Array): NullifierScheme {
  const keyCopy = key.slice();
  return {
    name: "keyed-v1",
    walletNullifier(family: string, address: string): string {
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
export function walletSetNullifier(
  entries: readonly Pick<WalletNullifierEntry, "family" | "walletNullifier">[],
): string {
  const sorted = entries.map((entry) => `${entry.family}:${entry.walletNullifier}`).sort();
  return sha256Hex(`${DOMAIN.identity}|${sorted.join("|")}`);
}

export function walletEntriesFromAddresses(
  wallets: readonly { family: "evm" | "solana"; address: string; chainId?: number }[],
  scheme: NullifierScheme = LEGACY_NULLIFIER_SCHEME,
): WalletNullifierEntry[] {
  return wallets.map((wallet) => ({
    walletNullifier: scheme.walletNullifier(wallet.family, wallet.address),
    family: wallet.family,
    chainId: wallet.chainId ?? 0,
  }));
}
