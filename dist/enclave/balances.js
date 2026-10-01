import { CHAINS, MAX_ASSETS_PER_REQUEST, } from "../shared/constants.js";
import { hexToBytes } from "../shared/crypto.js";
import { jsonRpc, RpcDisagreementError } from "./rpc.js";
/** Plaintext RPC would let a network observer read and rewrite balance reads. */
export function httpsUrl(url) {
    return url !== undefined && url.startsWith("https://") ? url : undefined;
}
/**
 * The primary value wins when the secondary agrees within 0.1%; anything
 * beyond that throws. Zero agrees only with zero. Small tolerance covers
 * ordinary provider lag while making silent inflation impossible.
 */
export function requireAgreement(primary, secondary) {
    if (secondary === null)
        return primary;
    const hi = primary > secondary ? primary : secondary;
    const lo = primary > secondary ? secondary : primary;
    if (hi === 0n)
        return 0n;
    if ((hi - lo) * 1000n > hi) {
        throw new RpcDisagreementError(`redundant RPC providers disagree: ${primary} vs ${secondary}`);
    }
    return primary;
}
const ERC20_BALANCE_OF = "0x70a08231";
const ERC20_DECIMALS = "0x313ce567";
const ERC20_SYMBOL = "0x95d89b41";
/** Resolve EVM RPC endpoints from the environment, one per chain. */
export function evmRpcsFromEnv(env = process.env) {
    const out = [];
    for (const chain of CHAINS) {
        if (chain.family !== "evm")
            continue;
        const url = httpsUrl(env[chain.defaultRpcEnv] ?? env[`${chain.defaultRpcEnv}_URL`]);
        if (!url)
            continue;
        const secondary = httpsUrl(env[`${chain.defaultRpcEnv}_SECONDARY`] ?? env[`${chain.defaultRpcEnv}_URL_SECONDARY`]);
        out.push({ chain, rpcUrl: url, ...(secondary ? { secondaryRpcUrl: secondary } : {}) });
    }
    return out;
}
function pad32(address) {
    return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}
function decodeUint(hex) {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length === 0)
        return 0n;
    return BigInt(`0x${clean}`);
}
function decodeString(hex) {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length < 128)
        return null;
    const length = Number(BigInt(`0x${clean.slice(64, 128)}`));
    if (length <= 0 || length > 64)
        return null;
    const data = clean.slice(128, 128 + length * 2);
    const bytes = hexToBytes(data);
    return new TextDecoder().decode(bytes).replace(/\0+$/, "");
}
/**
 * Fetch the full ERC-20 balance set for an address. With no token allowlist,
 * discovery has to enumerate holdings: provider token-balance enumeration when
 * the RPC supports it, otherwise Transfer-log scanning fallback. balanceOf is
 * then read for every unique contract.
 */
export async function discoverEvmBalances(address, rpcs, maxBalances = MAX_ASSETS_PER_REQUEST) {
    const balances = [];
    const lowerAddress = address.toLowerCase();
    for (const { chain, rpcUrl, secondaryRpcUrl } of rpcs) {
        if (balances.length >= maxBalances)
            break;
        const native = await safeNativeBalance(address, chain, rpcUrl, secondaryRpcUrl);
        if (native)
            balances.push(native);
        const tokenAddresses = await discoverErc20Contracts(lowerAddress, rpcUrl);
        for (const token of tokenAddresses) {
            if (balances.length >= maxBalances)
                break;
            const balance = await readErc20(address, token, chain, rpcUrl, secondaryRpcUrl);
            if (balance && balance.balanceRaw > 0n)
                balances.push(balance);
        }
    }
    return balances;
}
async function safeNativeBalance(address, chain, rpcUrl, secondaryRpcUrl) {
    const primaryHex = await jsonRpc(rpcUrl, "eth_getBalance", [address, "latest"]).catch(() => null);
    if (primaryHex === null)
        return null;
    let secondaryRaw = null;
    if (secondaryRpcUrl) {
        const secondaryHex = await jsonRpc(secondaryRpcUrl, "eth_getBalance", [
            address,
            "latest",
        ]).catch(() => null);
        if (secondaryHex === null)
            return null;
        secondaryRaw = decodeUint(secondaryHex);
    }
    const balanceRaw = requireAgreement(decodeUint(primaryHex), secondaryRaw);
    if (balanceRaw <= 0n)
        return null;
    return {
        chainId: chain.chainId,
        family: "evm",
        asset: "native",
        symbol: chain.nativeSymbol,
        decimals: chain.nativeDecimals,
        balanceRaw,
    };
}
/**
 * Discover ERC-20 contracts. Prefer the RPC provider's token-balance
 * enumeration (Alchemy-compatible, covers all historical holdings); when the
 * provider rejects the method, fall back to scanning Transfer logs in both
 * directions over a recent window.
 */
async function discoverErc20Contracts(lowerAddress, rpcUrl) {
    const viaProvider = await providerTokenBalances(lowerAddress, rpcUrl);
    if (viaProvider)
        return viaProvider;
    const tokens = new Set();
    const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const padded = `0x${pad32(lowerAddress)}`;
    try {
        const blockHex = await jsonRpc(rpcUrl, "eth_blockNumber", []);
        const latest = Number(decodeUint(blockHex));
        const span = 50_000;
        const fromBlock = Math.max(0, latest - span);
        for (const position of [1, 2]) {
            const logs = await jsonRpc(rpcUrl, "eth_getLogs", [
                {
                    fromBlock: `0x${fromBlock.toString(16)}`,
                    toBlock: "latest",
                    topics: [transferTopic, ...(position === 1 ? [null, padded] : [padded])],
                },
            ]);
            for (const log of logs)
                tokens.add(log.address.toLowerCase());
        }
    }
    catch {
        // Range/limit unsupported: return whatever the provider enumeration found.
    }
    return tokens;
}
const MAX_TOKEN_PAGES = 8;
const MAX_DISCOVERED_TOKENS = 2000;
/**
 * Alchemy-compatible full balance enumeration, following provider pagination.
 * Returns null (not an empty set) when the method is unavailable so the caller
 * can use the log fallback.
 */
async function providerTokenBalances(lowerAddress, rpcUrl) {
    const tokens = new Set();
    let pageKey;
    for (let page = 0; page < MAX_TOKEN_PAGES; page++) {
        let result;
        try {
            const params = pageKey === undefined ? [lowerAddress, "erc20"] : [lowerAddress, "erc20", { pageKey }];
            result = await jsonRpc(rpcUrl, "alchemy_getTokenBalances", params);
        }
        catch {
            return page === 0 ? null : tokens;
        }
        if (!Array.isArray(result.tokenBalances))
            return page === 0 ? null : tokens;
        for (const entry of result.tokenBalances) {
            if (!entry.contractAddress)
                continue;
            if (entry.tokenBalance && decodeUint(entry.tokenBalance) === 0n)
                continue;
            tokens.add(entry.contractAddress.toLowerCase());
            if (tokens.size >= MAX_DISCOVERED_TOKENS)
                return tokens;
        }
        if (typeof result.pageKey !== "string" || result.pageKey.length === 0)
            return tokens;
        pageKey = result.pageKey;
    }
    return tokens;
}
/** Read balanceOf/decimals/symbol for one ERC-20. */
async function readErc20(owner, token, chain, rpcUrl, secondaryRpcUrl) {
    try {
        const balanceCall = [
            { to: token, data: `${ERC20_BALANCE_OF}${pad32(owner)}` },
            "latest",
        ];
        const balanceHex = await jsonRpc(rpcUrl, "eth_call", [...balanceCall]).catch(() => null);
        if (balanceHex === null)
            return null;
        let secondaryRaw = null;
        if (secondaryRpcUrl) {
            const secondaryHex = await jsonRpc(secondaryRpcUrl, "eth_call", [
                ...balanceCall,
            ]).catch(() => null);
            if (secondaryHex === null)
                return null;
            secondaryRaw = decodeUint(secondaryHex);
        }
        const balanceRaw = requireAgreement(decodeUint(balanceHex), secondaryRaw);
        if (balanceRaw <= 0n)
            return null;
        const decHex = await jsonRpc(rpcUrl, "eth_call", [
            { to: token, data: ERC20_DECIMALS },
            "latest",
        ]).catch(() => null);
        if (decHex === null)
            return null;
        if (secondaryRpcUrl) {
            const decSecondaryHex = await jsonRpc(secondaryRpcUrl, "eth_call", [
                { to: token, data: ERC20_DECIMALS },
                "latest",
            ]).catch(() => null);
            if (decSecondaryHex === null)
                return null;
            // Decimals are value-critical (10^decimals divides the value) and must
            // match exactly; there is no honest reason for providers to differ.
            if (decodeUint(decHex) !== decodeUint(decSecondaryHex)) {
                throw new RpcDisagreementError(`redundant RPC providers disagree on decimals`);
            }
        }
        const decimals = Number(decodeUint(decHex));
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
            return null;
        let symbol;
        try {
            const symHex = await jsonRpc(rpcUrl, "eth_call", [
                { to: token, data: ERC20_SYMBOL },
                "latest",
            ]);
            symbol = decodeString(symHex) ?? token.slice(0, 10);
        }
        catch {
            symbol = token.slice(0, 10);
        }
        return {
            chainId: chain.chainId,
            family: "evm",
            asset: token.toLowerCase(),
            symbol,
            decimals,
            balanceRaw,
        };
    }
    catch {
        return null;
    }
}
