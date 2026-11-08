import assert from "node:assert/strict";
import test from "node:test";
import { FixedWindowRateLimiter } from "../src/common/rate-limit.js";

test("allows requests up to the limit and returns retry-after when exhausted", () => {
  const now = 1_000;
  const limiter = new FixedWindowRateLimiter(() => now);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(limiter.check("ip:1", 3, 60_000).allowed, true);
  }
  const denied = limiter.check("ip:1", 3, 60_000);
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.retryAfterSeconds, 60);
});

test("resets after the window and keeps separate keys isolated", () => {
  let now = 0;
  const limiter = new FixedWindowRateLimiter(() => now);
  assert.equal(limiter.check("a", 1, 1_000).allowed, true);
  assert.equal(limiter.check("a", 1, 1_000).allowed, false);
  assert.equal(limiter.check("b", 1, 1_000).allowed, true);
  now = 1_000;
  assert.equal(limiter.check("a", 1, 1_000).allowed, true);
});
