import type { RawBalance } from "./balances.ts";
/**
 * Discover all SPL token balances plus native SOL for a Solana address using
 * getTokenAccountsByOwner (which enumerates every token account the owner
 * holds) and getBalance. Amounts come back as raw integer strings.
 */
export declare function discoverSolanaBalances(address: string, rpcUrl: string, maxBalances?: number, secondaryRpcUrl?: string): Promise<RawBalance[]>;
