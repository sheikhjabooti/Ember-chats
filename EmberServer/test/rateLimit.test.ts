import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/middleware/rateLimit";

test("allows up to the limit in the window, then says how long to wait", () => {
  const limiter = new RateLimiter(3, 10_000);
  const t = 1_000_000;
  assert.equal(limiter.hit("a", t), 0);
  assert.equal(limiter.hit("a", t + 1), 0);
  assert.equal(limiter.hit("a", t + 2), 0);
  assert.equal(limiter.hit("a", t + 3), 10);
  assert.equal(limiter.hit("b", t + 3), 0, "keys are independent");
  assert.equal(limiter.hit("a", t + 10_001), 0, "the oldest hit has aged out");
});

test("sweep forgets idle keys", () => {
  const limiter = new RateLimiter(1, 1000);
  limiter.hit("a", 0);
  limiter.sweep(5000);
  assert.equal(limiter.hit("a", 5000), 0);
});
