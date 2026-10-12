import type { RawBalance } from "./balances.ts";
/**
 * Discover all SPL token balances plus native SOL for a Solana address using
 * getTokenAccountsByOwner (which enumerates every token account the owner
 * holds) and getBalance. Amounts come back as raw integer strings.
 *
 * The two token programs resolve concurrently and per-account secondary
 * agreement fans out with bounded parallelism; results merge in program and
 * account order with the budget truncating deterministically — identical
 * results to sequential collection. Disagreement still throws; unreachable
 * secondaries still skip, per account.
 */
export declare function discoverSolanaBalances(address: string, rpcUrl: string, maxBalances?: number, secondaryRpcUrl?: string): Promise<RawBalance[]>;
