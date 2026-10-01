/** Minimal JSON-RPC 2.0 client with timeout and response-size limits. */
export declare class RpcError extends Error {
}
/**
 * Thrown when redundant providers disagree beyond tolerance on a
 * value-critical read. Never swallowed by balance collection: disagreement
 * fails the registration instead of silently trusting one side.
 */
export declare class RpcDisagreementError extends Error {
}
export declare function jsonRpc<T>(url: string, method: string, params: unknown[], timeoutMs?: number): Promise<T>;
export declare function getJson<T>(url: string, headers?: Record<string, string>, timeoutMs?: number): Promise<T>;
