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

test("devnet chains are opt-in", () => {
  const prod = evmRpcsFromEnv({
    SIXFIGS_RPC_SEPOLIA: "https://sepolia.example",
  } as NodeJS.ProcessEnv);
  assert.equal(
    prod.some((entry) => entry.chain.chainId === 11155111),
    false,
  );

  const dev = evmRpcsFromEnv({
    SIXFIGS_RPC_SEPOLIA: "https://sepolia.example",
    SIXFIGS_DEV_CHAINS: "1",
  } as NodeJS.ProcessEnv);
  const sepolia = dev.find((entry) => entry.chain.chainId === 11155111);
  assert.equal(sepolia?.chain.name, "sepolia");
  assert.equal(sepolia?.rpcUrl, "https://sepolia.example");
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

function tokenAddr(n: number): string {
  return `0x${n.toString(16).padStart(40, "0")}`;
}

function delayedRpc(
  handler: (url: string, method: string, params: unknown[]) => Promise<unknown>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as {
      method: string;
      params: unknown[];
    };
    const result = await handler(String(url), payload.method, payload.params);
    return {
      ok: true,
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
    };
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("EVM chains merge in configured order under concurrency", async () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const restore = delayedRpc(async (url, method, params) => {
    const slow = url.includes("slow");
    if (method === "eth_getBalance") {
      await sleep(slow ? 60 : 5);
      return "0x64";
    }
    if (method === "alchemy_getTokenBalances") {
      await sleep(slow ? 60 : 5);
      const base = slow ? 100 : 200;
      return {
        tokenBalances: [1, 2].map((i) => ({
          contractAddress: tokenAddr(base + i),
          tokenBalance: "0x64",
        })),
      };
    }
    if (method === "eth_call") {
      const data = String((params[0] as { data?: string })?.data ?? "");
      await sleep(10);
      if (data.startsWith("0x70a08231")) return "0x64";
      if (data.startsWith("0x313ce567")) return "0x12";
      throw new Error("no symbol");
    }
    throw new Error(`unexpected ${method}`);
  });
  try {
    const out = await discoverEvmBalances("0xabc", [
      { chain: ethChain, rpcUrl: "https://slow.example" },
      { chain: ethChain, rpcUrl: "https://fast.example" },
    ]);
    // Slow chain first despite finishing last: native, A-tokens, native, B-tokens.
    assert.deepEqual(
      out.map((b) => b.asset),
      ["native", tokenAddr(101), tokenAddr(102), "native", tokenAddr(201), tokenAddr(202)],
    );
  } finally {
    restore();
  }
});

test("EVM asset budget truncates deterministically in chain order", async () => {
  const restore = delayedRpc(async (_url, method, params) => {
    if (method === "eth_getBalance") return "0x64";
    if (method === "alchemy_getTokenBalances") {
      return { tokenBalances: [{ contractAddress: tokenAddr(7), tokenBalance: "0x64" }] };
    }
    if (method === "eth_call") {
      const data = String((params[0] as { data?: string })?.data ?? "");
      if (data.startsWith("0x70a08231")) return "0x64";
      if (data.startsWith("0x313ce567")) return "0x12";
      throw new Error("no symbol");
    }
    throw new Error(`unexpected ${method}`);
  });
  try {
    const out = await discoverEvmBalances(
      "0xabc",
      [
        { chain: ethChain, rpcUrl: "https://a.example" },
        { chain: ethChain, rpcUrl: "https://b.example" },
      ],
      3,
    );
    assert.deepEqual(out.map((b) => b.asset), ["native", tokenAddr(7), "native"]);
  } finally {
    restore();
  }
});

test("EVM native disagreement still aborts the request", async () => {
  const restore = delayedRpc(async (url, method) => {
    if (method === "eth_getBalance") {
      return url.includes("secondary") ? "0xc8" : "0x64";
    }
    if (method === "alchemy_getTokenBalances") return { tokenBalances: [] };
    throw new Error(`unexpected ${method}`);
  });
  try {
    await assert.rejects(
      discoverEvmBalances("0xabc", [
        { chain: ethChain, rpcUrl: "https://a.example", secondaryRpcUrl: "https://secondary.example" },
      ]),
      RpcDisagreementError,
    );
  } finally {
    restore();
  }
});

const MINT_A = "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const MINT_B = "MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function solAccount(mint: string, amount: string): unknown {
  return {
    pubkey: `acct-${mint.slice(0, 6)}`,
    account: {
      data: { parsed: { info: { mint, tokenAmount: { amount, decimals: 6 } } } },
    },
  };
}

test("Solana programs merge in order under concurrency", async () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const restore = delayedRpc(async (_url, method, params) => {
    if (method === "getBalance") return { value: 7 };
    if (method === "getTokenAccountsByOwner") {
      const programId = (params[1] as { programId?: string })?.programId ?? "";
      await sleep(programId.includes("Tokenz") ? 5 : 60);
      const mint = programId.includes("Tokenz") ? MINT_B : MINT_A;
      return { value: [solAccount(mint, "9")] };
    }
    throw new Error(`unexpected ${method}`);
  });
  try {
    const out = await discoverSolanaBalances("addr", "https://sol.example");
    assert.deepEqual(
      out.map((b) => b.asset),
      ["native", MINT_A, MINT_B],
    );
  } finally {
    restore();
  }
});

test("Solana token disagreement still aborts the request", async () => {
  const restore = delayedRpc(async (url, method) => {
    if (method === "getBalance") return { value: 7 };
    if (method === "getTokenAccountsByOwner") return { value: [solAccount(MINT_A, "9")] };
    if (method === "getAccountInfo") {
      if (url.includes("secondary")) {
        return {
          value: { data: { parsed: { info: { tokenAmount: { amount: "99", decimals: 6 } } } } },
        };
      }
      return {
        value: { data: { parsed: { info: { tokenAmount: { amount: "9", decimals: 6 } } } } },
      };
    }
    throw new Error(`unexpected ${method}`);
  });
  try {
    await assert.rejects(
      discoverSolanaBalances("addr", "https://sol.example", 300, "https://secondary.example"),
      RpcDisagreementError,
    );
  } finally {
    restore();
  }
});
