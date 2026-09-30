/**
 * In-memory request controls for the single enclave instance. These bound the
 * damage one client can do to provider quotas and the event loop; they are not
 * a substitute for load-balancer rate limiting.
 */

/** Fixed-window per-key limiter. Windows are pruned once the map grows. */
export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  allow(key: string): boolean {
    const at = this.now();
    const entry = this.hits.get(key);
    if (!entry || at - entry.windowStart >= this.windowMs) {
      if (this.hits.size > 5_000) this.prune();
      this.hits.set(key, { count: 1, windowStart: at });
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count += 1;
    return true;
  }

  prune(): void {
    const at = this.now();
    for (const [key, entry] of this.hits) {
      if (at - entry.windowStart >= this.windowMs) this.hits.delete(key);
    }
  }
}

/**
 * Remembers processed request nonces for one freshness window so a captured
 * envelope cannot be replayed. Checked after the concurrency gate so overload
 * refusals never burn a nonce.
 */
export class SeenNonces {
  private readonly seenAt = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs: number = 120_000, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  /** Returns true when the nonce was already recorded (a replay). */
  seen(nonce: string): boolean {
    const at = this.now();
    const previous = this.seenAt.get(nonce);
    if (previous !== undefined && at - previous < this.ttlMs) return true;
    if (this.seenAt.size > 10_000) this.prune(at);
    this.seenAt.set(nonce, at);
    return false;
  }

  prune(now: number = this.now()): void {
    for (const [nonce, at] of this.seenAt) {
      if (now - at >= this.ttlMs) this.seenAt.delete(nonce);
    }
  }
}

/** Bounds concurrent expensive registrations on the single-threaded workload. */
export class ConcurrencyGate {
  private active = 0;
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  tryEnter(): boolean {
    if (this.active >= this.max) return false;
    this.active += 1;
    return true;
  }

  leave(): void {
    if (this.active > 0) this.active -= 1;
  }

  get inFlight(): number {
    return this.active;
  }
}