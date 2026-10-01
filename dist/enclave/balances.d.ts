import { type ChainConfig } from "../shared/constants.ts";
export interface EvmRpcConfig {
    chain: ChainConfig;
    rpcUrl: string;
    secondaryRpcUrl?: string;
}
/** Plaintext RPC would let a network observer read and rewrite balance reads. */
export declare function httpsUrl(url: string | undefined): string | undefined;
/**
 * The primary value wins when the secondary agrees within 0.1%; anything
 * beyond that throws. Zero agrees only with zero. Small tolerance covers
 * ordinary provider lag while making silent inflation impossible.
 */
export declare function requireAgreement(primary: bigint, secondary: bigint | null): bigint;
export interface RawBalance {
    chainId: number;
    family: "evm" | "solana";
    /** Token contract address (lowercased for EVM), or "native". */
    asset: string;
    symbol: string;
    decimals: number;
    balanceRaw: bigint;
}
/** Resolve EVM RPC endpoints from the environment, one per chain. */
export declare function evmRpcsFromEnv(env?: NodeJS.ProcessEnv): EvmRpcConfig[];
/**
 * Fetch the full ERC-20 balance set for an address. With no token allowlist,
 * discovery has to enumerate holdings: provider token-balance enumeration when
 * the RPC supports it, otherwise Transfer-log scanning fallback. balanceOf is
 * then read for every unique contract.
 */
export declare function discoverEvmBalances(address: string, rpcs: EvmRpcConfig[], maxBalances?: number): Promise<RawBalance[]>;
