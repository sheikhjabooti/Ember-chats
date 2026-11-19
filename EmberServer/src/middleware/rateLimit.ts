import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { AuthedRequest } from "./requireAuth";

/**
 * A small sliding-window limiter kept in memory. Good enough for one
 * server instance; with several instances, move the counters to Redis.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    readonly limit: number,
    readonly windowMs: number
  ) {}

  /** Records a hit for `key`. Returns 0 if allowed, otherwise seconds until the next slot frees up. */
  hit(key: string, now = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    return 0;
  }

  /** Drops keys with no recent hits so memory doesn't grow forever. */
  sweep(now = Date.now()) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

const allLimiters: RateLimiter[] = [];
setInterval(() => allLimiters.forEach((l) => l.sweep()), 60_000).unref();

/**
 * Express middleware. Keys by user id when signed in (so people behind
 * one shared IP don't block each other), otherwise by IP.
 */
export function rateLimit(name: string, limit: number, windowSeconds: number) {
  const limiter = new RateLimiter(limit, windowSeconds * 1000);
  allLimiters.push(limiter);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.rateLimitsEnabled) return next();
    const who = (req as AuthedRequest).userId ?? req.ip ?? "unknown";
    const retryAfter = limiter.hit(`${name}:${who}`);
    if (retryAfter > 0) {
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: `Too many requests. Try again in ${retryAfter}s.` });
    }
    next();
  };
}
