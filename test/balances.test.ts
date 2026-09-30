import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAINS } from "../src/shared/constants.ts";
import {
  discoverEvmBalances,
  evmRpcsFromEnv,
  requireAgreement,
} from "../src/enclave/balances.ts";
import { discoverSolanaBalances } from "../src/enclave/solana.ts";
import { RpcDisagreementError } from "../src/enclave/rpc.ts";

type RpcHandler = (url: string, method: string, params: unknown[]) => unknown;

function stubFetch(handler: RpcHandler): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as {
      method: string;
      params: unknown[];
    };
    const result = handler(String(url), payload.method, payload.params);
    return {
      ok: true,
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
    };
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const ethChain = CHAINS.find((chain) => chain.chainId === 1)!;

test("non-https RPC endpoints are ignored", () => {
  const rpcs = evmRpcsFromEnv({
    SIXFIGS_RPC_ETHEREUM: "http://plaintext-rpc",
    SIXFIGS_RPC_BASE: "https://base.example",
  } as NodeJS.ProcessEnv);
  assert.equal(
    rpcs.some((entry) => entry.chain.chainId === 1),
    false,
  );
  assert.equal(
    rpcs.some((entry) => entry.chain.chainId === 8453),
    true,
  );
});

test("agreement accepts matching providers and rejects drift", () => {
  assert.equal(requireAgreement(100n, 100n), 100n);
  assert.equal(requireAgreement(100n, null), 100n);
  assert.equal(requireAgreement(0n, 0n), 0n);
  assert.equal(requireAgreement(1000n, 1001n), 1000n);
  assert.throws(() => requireAgreement(100n, 200n), RpcDisagreementError);
});

test("EVM native balance agrees across providers", async () => {
  const restore = stubFetch((_url, method) => {
    if (method === "eth_getBalance") return "0x64";
    if (method === "alchemy_getTokenBalances") return { tokenBalances: [] };
    throw new Error(`unexpected ${method}`);
  });
  try {
    const balances = await discoverEvmBalances("0xabc", [
      { chain: ethChain, rpcUrl: "https://primary", secondaryRpcUrl: "https://secondary" },
    ]);
    assert.equal(balances.length, 1);
    assert.equal(balances[0]!.balanceRaw, 100n);
  } finally {
    restore();
  }
});

test("EVM provider disagreement fails instead of trusting either side", async () => {
  const restore = stubFetch((url, method) => {
    if (method === "eth_getBalance") return url.includes("primary") ? "0x64" : "0xC8";
    if (method === "alchemy_getTokenBalances") return { tokenBalances: [] };
    throw new Error(`unexpected ${method}`);
  });
  try {
    await assert.rejects(
      () =>
        discoverEvmBalances("0xabc", [
          {
            chain: ethChain,
            rpcUrl: "https://primary",
            secondaryRpcUrl: "https://secondary",
          },
        ]),
      RpcDisagreementError,
    );
  } finally {
    restore();
  }
});

test("EVM skips the chain when the secondary is unreachable", async () => {
  const restore = stubFetch((url, method) => {
    if (url.includes("secondary")) throw new Error("secondary down");
    if (method === "eth_getBalance") return "0x64";
    if (method === "alchemy_getTokenBalances") return { tokenBalances: [] };
    throw new Error(`unexpected ${method}`);
  });
  try {
    const balances = await discoverEvmBalances("0xabc", [
      { chain: ethChain, rpcUrl: "https://primary", secondaryRpcUrl: "https://secondary" },
    ]);
    assert.equal(balances.length, 0);
  } finally {
    restore();
  }
});

test("EVM token enumeration follows provider pages", async () => {
  const first = "0x1111111111111111111111111111111111111111";
  const second = "0x2222222222222222222222222222222222222222";
  const restore = stubFetch((_url, method, params) => {
    if (method === "eth_getBalance") return "0x0";
    if (method === "alchemy_getTokenBalances") {
      const options = (params as unknown[])[2] as { pageKey?: string } | undefined;
      if (!options?.pageKey) {
        return {
          tokenBalances: [{ contractAddress: first, tokenBalance: "0x1" }],
          pageKey: "p2",
        };
      }
      return { tokenBalances: [{ contractAddress: second, tokenBalance: "0x1" }] };
    }
    if (method === "eth_call") {
      const data = ((params as unknown[])[0] as { data: string }).data;
      if (data.startsWith("0x70a08231")) return "0x64";
      if (data.startsWith("0x313ce567")) return "0x12";
      return "0x";
    }
    throw new Error(`unexpected ${method}`);
  });
  try {
    const balances = await discoverEvmBalances("0xabc", [
      { chain: ethChain, rpcUrl: "https://primary" },
    ]);
    const assets = balances.map((balance) => balance.asset);
    assert.ok(assets.includes(first));
    assert.ok(assets.includes(second));
  } finally {
    restore();
  }
});

test("Solana native balance agrees across providers", async () => {
  const restore = stubFetch((_url, method) => {
    if (method === "getBalance") return { value: 7 };
    if (method === "getTokenAccountsByOwner") return { value: [] };
    throw new Error(`unexpected ${method}`);
  });
  try {
    const balances = await discoverSolanaBalances(
      "addr",
      "https://primary",
      300,
      "https://secondary",
    );
    assert.equal(balances.length, 1);
    assert.equal(balances[0]!.balanceRaw, 7n);
  } finally {
    restore();
  }
});

test("Solana provider disagreement fails", async () => {
  const restore = stubFetch((url, method) => {
    if (method === "getBalance") return { value: url.includes("primary") ? 7 : 700 };
    if (method === "getTokenAccountsByOwner") return { value: [] };
    throw new Error(`unexpected ${method}`);
  });
  try {
    await assert.rejects(
      () => discoverSolanaBalances("addr", "https://primary", 300, "https://secondary"),
      RpcDisagreementError,
    );
  } finally {
    restore();
  }
});

test("Solana token amounts agree per account", async () => {
  let listings = 0;
  const restore = stubFetch((_url, method) => {
    if (method === "getBalance") return { value: 0 };
    if (method === "getTokenAccountsByOwner") {
      listings++;
      if (listings > 1) return { value: [] };
      return {
        value: [
          {
            pubkey: "acct1",
            account: {
              data: {
                parsed: {
                  info: { mint: "MINT1", tokenAmount: { amount: "42", decimals: 6 } },
                },
              },
            },
          },
        ],
      };
    }
    if (method === "getAccountInfo") {
      return {
        value: {
          data: { parsed: { info: { tokenAmount: { amount: "42", decimals: 6 } } } },
        },
      };
    }
    throw new Error(`unexpected ${method}`);
  });
  try {
    const balances = await discoverSolanaBalances(
      "addr",
      "https://primary",
      300,
      "https://secondary",
    );
    assert.equal(balances.length, 1);
    assert.equal(balances[0]!.asset, "MINT1");
    assert.equal(balances[0]!.balanceRaw, 42n);
  } finally {
    restore();
  }
});
