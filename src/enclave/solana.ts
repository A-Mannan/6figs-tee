import { MAX_ASSETS_PER_REQUEST } from "../shared/constants.ts";
import { jsonRpc, RpcDisagreementError } from "./rpc.ts";
import { requireAgreement } from "./balances.ts";
import type { RawBalance } from "./balances.ts";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Discover all SPL token balances plus native SOL for a Solana address using
 * getTokenAccountsByOwner (which enumerates every token account the owner
 * holds) and getBalance. Amounts come back as raw integer strings.
 */
export async function discoverSolanaBalances(
  address: string,
  rpcUrl: string,
  maxBalances: number = MAX_ASSETS_PER_REQUEST,
  secondaryRpcUrl?: string,
): Promise<RawBalance[]> {
  const balances: RawBalance[] = [];
  try {
    const primary = await jsonRpc<{ value: number }>(rpcUrl, "getBalance", [address]);
    const value = await agreeNative(BigInt(primary.value), secondaryRpcUrl, address);
    if (value !== null && value > 0n) {
      balances.push({
        chainId: 0,
        family: "solana",
        asset: "native",
        symbol: "SOL",
        decimals: 9,
        balanceRaw: value,
      });
    }
  } catch (error) {
    if (error instanceof RpcDisagreementError) throw error;
    // ignore native lookup failure
  }

  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    if (balances.length >= maxBalances) break;
    try {
      const result = await jsonRpc<{
        value: Array<{
          pubkey: string;
          account: { data: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } } };
        }>;
      }>(rpcUrl, "getTokenAccountsByOwner", [
        address,
        { programId },
        { encoding: "jsonParsed" },
      ]);

      for (const account of result.value) {
        if (balances.length >= maxBalances) break;
        const info = account.account.data.parsed?.info;
        const mint = info?.mint;
        const amount = info?.tokenAmount?.amount;
        const decimals = info?.tokenAmount?.decimals;
        if (!mint || amount === undefined || decimals === undefined) continue;
        const agreed = await agreeTokenAccount(
          account.pubkey,
          BigInt(amount),
          decimals,
          secondaryRpcUrl,
        );
        if (agreed === null) continue;
        if (agreed.balanceRaw <= 0n) continue;

        const isNativeWrap = mint === WSOL_MINT;
        balances.push({
          chainId: 0,
          family: "solana",
          asset: mint,
          symbol: isNativeWrap ? "wSOL" : shortenMint(mint),
          decimals: agreed.decimals,
          balanceRaw: agreed.balanceRaw,
        });
      }
    } catch (error) {
      if (error instanceof RpcDisagreementError) throw error;
      // program not supported or RPC error: continue with other program
    }
  }

  return balances;
}

/**
 * Native agreement. Returns null (skip) when the secondary is configured but
 * unreachable; throws on disagreement.
 */
async function agreeNative(
  primary: bigint,
  secondaryRpcUrl: string | undefined,
  address: string,
): Promise<bigint | null> {
  if (!secondaryRpcUrl) return primary;
  const secondary = await jsonRpc<{ value: number }>(secondaryRpcUrl, "getBalance", [
    address,
  ]).catch(() => null);
  if (secondary === null) return null;
  return requireAgreement(primary, BigInt(secondary.value));
}

interface ParsedTokenAmount {
  amount?: string;
  decimals?: number;
}

/**
 * Per-token agreement against the same token account on the secondary
 * provider. Returns null (skip this token) when the secondary is unreachable;
 * throws on disagreement.
 */
async function agreeTokenAccount(
  pubkey: string,
  primaryAmount: bigint,
  primaryDecimals: number,
  secondaryRpcUrl: string | undefined,
): Promise<{ balanceRaw: bigint; decimals: number } | null> {
  if (!secondaryRpcUrl) return { balanceRaw: primaryAmount, decimals: primaryDecimals };
  const account = await jsonRpc<{
    value: { data: { parsed?: { info?: { tokenAmount?: ParsedTokenAmount } } } } | null;
  }>(secondaryRpcUrl, "getAccountInfo", [pubkey, { encoding: "jsonParsed" }]).catch(
    () => null,
  );
  if (account === null) return null;
  const tokenAmount = account.value?.data?.parsed?.info?.tokenAmount;
  if (!tokenAmount || tokenAmount.amount === undefined || tokenAmount.decimals === undefined) {
    return null;
  }
  if (tokenAmount.decimals !== primaryDecimals) {
    throw new RpcDisagreementError(`redundant RPC providers disagree on decimals`);
  }
  return {
    balanceRaw: requireAgreement(primaryAmount, BigInt(tokenAmount.amount)),
    decimals: primaryDecimals,
  };
}

function shortenMint(mint: string): string {
  return mint.length > 8 ? `${mint.slice(0, 4)}..${mint.slice(-4)}` : mint;
}