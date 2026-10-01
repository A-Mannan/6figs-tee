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
export declare function walletNullifier(family: string, address: string): string;
export declare const LEGACY_NULLIFIER_SCHEME: NullifierScheme;
/**
 * Keyed scheme. The separate v2 domain tag keeps the two formulas from ever
 * colliding, even if the key leaks.
 */
export declare function keyedNullifierScheme(key: Uint8Array): NullifierScheme;
/**
 * identity_nullifier = SHA-256(domain || sorted family:walletNullifier list).
 * The account *is* the wallet set: no client-held secret exists, so recovery is
 * exactly "sign again with the same wallets". Sets are order-independent, and
 * any change to membership produces a different identity. Scheme-agnostic: it
 * commits to whatever nullifier strings it is given.
 */
export declare function walletSetNullifier(entries: readonly Pick<WalletNullifierEntry, "family" | "walletNullifier">[]): string;
export declare function walletEntriesFromAddresses(wallets: readonly {
    family: "evm" | "solana";
    address: string;
    chainId?: number;
    label?: string;
}[], scheme?: NullifierScheme): WalletNullifierEntry[];
