export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

/**
 * Small fixed-window limiter for a single application instance.
 * The process is intentionally single-instance because the scheduler and
 * SQLite are single-writer; put a WAF/edge limiter in front for multi-IP abuse.
 */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  check(key: string, limit: number, windowMs: number): RateLimitDecision {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }

    if (bucket.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds: 0,
    };
  }

  sweep(now = this.now()): number {
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.buckets.size;
  }
}
