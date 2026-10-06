import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientAddress,
  ConcurrencyGate,
  FixedWindowRateLimiter,
  SeenNonces,
} from "../src/enclave/limits.ts";

test("rate limiter allows up to the limit, then rejects", () => {
  let now = 1_000;
  const limiter = new FixedWindowRateLimiter(3, 60_000, () => now);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
  assert.equal(limiter.allow("b"), true);
});

test("rate limiter window resets after the interval", () => {
  let now = 1_000;
  const limiter = new FixedWindowRateLimiter(1, 60_000, () => now);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
  now += 60_000;
  assert.equal(limiter.allow("a"), true);
});

test("rate limiter prunes stale windows", () => {
  let now = 1_000;
  const limiter = new FixedWindowRateLimiter(1, 60_000, () => now);
  for (let i = 0; i < 6_000; i++) limiter.allow(`key-${i}`);
  now += 60_000;
  limiter.allow("fresh");
  limiter.prune();
  assert.equal(limiter.allow("key-0"), true);
});

test("seen nonces reject replays within the window and expire after", () => {
  let now = 1_000;
  const seen = new SeenNonces(60_000, () => now);
  assert.equal(seen.seen("n1"), false);
  assert.equal(seen.seen("n1"), true);
  assert.equal(seen.seen("n2"), false);
  now += 60_000;
  assert.equal(seen.seen("n1"), false);
});

test("client address is the socket peer unless proxy trust is enabled", () => {
  assert.equal(clientAddress("10.0.0.7", "203.0.113.9,34.120.0.1", false), "10.0.0.7");
  assert.equal(clientAddress(undefined, undefined, true), "unknown");
});

test("client address is the load-balancer-appended client IP", () => {
  assert.equal(
    clientAddress("10.0.0.7", "203.0.113.9,34.120.0.1", true),
    "203.0.113.9",
  );
  assert.equal(
    clientAddress("10.0.0.7", "2001:db8::1,2600:1901::1", true),
    "2001:db8::1",
  );
});

test("client-supplied forwarded values cannot rotate the rate-limit key", () => {
  assert.equal(
    clientAddress("10.0.0.7", "spoofed,203.0.113.9, 34.120.0.1 ", true),
    "203.0.113.9",
  );
  assert.equal(
    clientAddress("10.0.0.7", ["spoofed", "203.0.113.9", "34.120.0.1"], true),
    "203.0.113.9",
  );
});

test("missing or malformed forwarded headers fall back to the socket peer", () => {
  assert.equal(clientAddress("10.0.0.7", "203.0.113.9", true), "10.0.0.7");
  assert.equal(clientAddress("10.0.0.7", "not-an-ip,34.120.0.1", true), "10.0.0.7");
  assert.equal(clientAddress("10.0.0.7", "", true), "10.0.0.7");
});

test("concurrency gate admits up to its capacity and resets", () => {
  const gate = new ConcurrencyGate(2);
  assert.equal(gate.tryEnter(), true);
  assert.equal(gate.tryEnter(), true);
  assert.equal(gate.tryEnter(), false);
  assert.equal(gate.inFlight, 2);
  gate.leave();
  assert.equal(gate.tryEnter(), true);
  gate.leave();
  gate.leave();
  gate.leave();
  assert.equal(gate.inFlight, 0);
});
