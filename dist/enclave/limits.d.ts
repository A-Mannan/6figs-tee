/**
 * In-memory request controls for the single enclave instance. These bound the
 * damage one client can do to provider quotas and the event loop; they are not
 * a substitute for load-balancer rate limiting.
 */
/** Fixed-window per-key limiter. Windows are pruned once the map grows. */
export declare class FixedWindowRateLimiter {
    private readonly hits;
    private readonly limit;
    private readonly windowMs;
    private readonly now;
    constructor(limit: number, windowMs: number, now?: () => number);
    allow(key: string): boolean;
    prune(): void;
}
/**
 * Remembers processed request nonces for one freshness window so a captured
 * envelope cannot be replayed. Checked after the concurrency gate so overload
 * refusals never burn a nonce.
 */
export declare class SeenNonces {
    private readonly seenAt;
    private readonly ttlMs;
    private readonly now;
    constructor(ttlMs?: number, now?: () => number);
    /** Returns true when the nonce was already recorded (a replay). */
    seen(nonce: string): boolean;
    prune(now?: number): void;
}
/** Bounds concurrent expensive registrations on the single-threaded workload. */
export declare class ConcurrencyGate {
    private active;
    private readonly max;
    constructor(max: number);
    tryEnter(): boolean;
    leave(): void;
    get inFlight(): number;
}
