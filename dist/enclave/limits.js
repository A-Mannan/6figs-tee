import { isIP } from "node:net";
/**
 * In-memory request controls for the single enclave instance. These bound the
 * damage one client can do to provider quotas and the event loop; they are not
 * a substitute for load-balancer rate limiting.
 */
/**
 * Rate-limit key for a request. Behind the GCP external Application Load
 * Balancer the socket peer is the GFE, and the client address is the
 * second-to-last `X-Forwarded-For` entry: the balancer appends
 * `<client-ip>,<load-balancer-ip>` after any client-supplied values, which are
 * never trusted. Absent or malformed input falls back to the socket peer, so
 * failures share a bucket instead of evading the limit.
 */
export function clientAddress(remoteAddress, forwardedFor, trustProxy) {
    const peer = remoteAddress ?? "unknown";
    if (!trustProxy || forwardedFor === undefined)
        return peer;
    const raw = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
    const entries = raw.split(",");
    if (entries.length < 2)
        return peer;
    const candidate = entries[entries.length - 2].trim();
    return isIP(candidate) !== 0 ? candidate : peer;
}
/** Fixed-window per-key limiter. Windows are pruned once the map grows. */
export class FixedWindowRateLimiter {
    hits = new Map();
    limit;
    windowMs;
    now;
    constructor(limit, windowMs, now = Date.now) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.now = now;
    }
    allow(key) {
        const at = this.now();
        const entry = this.hits.get(key);
        if (!entry || at - entry.windowStart >= this.windowMs) {
            if (this.hits.size > 5_000)
                this.prune();
            this.hits.set(key, { count: 1, windowStart: at });
            return true;
        }
        if (entry.count >= this.limit)
            return false;
        entry.count += 1;
        return true;
    }
    prune() {
        const at = this.now();
        for (const [key, entry] of this.hits) {
            if (at - entry.windowStart >= this.windowMs)
                this.hits.delete(key);
        }
    }
}
/**
 * Remembers processed request nonces for one freshness window so a captured
 * envelope cannot be replayed. Checked after the concurrency gate so overload
 * refusals never burn a nonce.
 */
export class SeenNonces {
    seenAt = new Map();
    ttlMs;
    now;
    constructor(ttlMs = 120_000, now = Date.now) {
        this.ttlMs = ttlMs;
        this.now = now;
    }
    /** Returns true when the nonce was already recorded (a replay). */
    seen(nonce) {
        const at = this.now();
        const previous = this.seenAt.get(nonce);
        if (previous !== undefined && at - previous < this.ttlMs)
            return true;
        if (this.seenAt.size > 10_000)
            this.prune(at);
        this.seenAt.set(nonce, at);
        return false;
    }
    prune(now = this.now()) {
        for (const [nonce, at] of this.seenAt) {
            if (now - at >= this.ttlMs)
                this.seenAt.delete(nonce);
        }
    }
}
/** Bounds concurrent expensive registrations on the single-threaded workload. */
export class ConcurrencyGate {
    active = 0;
    max;
    constructor(max) {
        this.max = max;
    }
    tryEnter() {
        if (this.active >= this.max)
            return false;
        this.active += 1;
        return true;
    }
    leave() {
        if (this.active > 0)
            this.active -= 1;
    }
    get inFlight() {
        return this.active;
    }
}
