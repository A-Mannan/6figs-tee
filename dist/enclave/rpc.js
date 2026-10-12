/** Minimal JSON-RPC 2.0 client with timeout and response-size limits. */
export class RpcError extends Error {
}
/**
 * Thrown when redundant providers disagree beyond tolerance on a
 * value-critical read. Never swallowed by balance collection: disagreement
 * fails the registration instead of silently trusting one side.
 */
export class RpcDisagreementError extends Error {
}
/**
 * Bounded-parallel fan-out preserving input order. Independent provider
 * calls run concurrently instead of serially; the limit keeps one
 * registration from hammering an API with hundreds of in-flight requests.
 */
export async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return out;
}
let nextId = 1;
export async function jsonRpc(url, method, params, timeoutMs = 10_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new RpcError(`rpc ${method} http ${response.status}`);
        }
        const text = await response.text();
        if (text.length > 4_000_000)
            throw new RpcError(`rpc ${method} response too large`);
        const json = JSON.parse(text);
        if (json.error)
            throw new RpcError(`rpc ${method} error: ${json.error.message}`);
        if (json.result === undefined)
            throw new RpcError(`rpc ${method} returned no result`);
        return json.result;
    }
    finally {
        clearTimeout(timer);
    }
}
export async function getJson(url, headers = {}, timeoutMs = 10_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok)
            throw new RpcError(`http ${response.status} for ${url}`);
        const text = await response.text();
        if (text.length > 12_000_000)
            throw new RpcError(`response too large for ${url}`);
        return JSON.parse(text);
    }
    finally {
        clearTimeout(timer);
    }
}
