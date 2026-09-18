export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): boolean | Promise<boolean>
}

interface Bucket {
  count: number
  resetAt: number
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxBuckets = 10_000
  ) {
    if (!Number.isInteger(maxBuckets) || maxBuckets < 1) throw new Error('Rate limiter bucket limit is invalid')
  }

  consume(key: string, limit: number, windowMs: number): boolean {
    const currentTime = this.now()
    const current = this.buckets.get(key)
    if (!current || current.resetAt <= currentTime) {
      if (!current && this.buckets.size >= this.maxBuckets) {
        for (const [bucketKey, bucket] of this.buckets) {
          if (bucket.resetAt <= currentTime) this.buckets.delete(bucketKey)
        }
        // Bound memory under a high-cardinality address/key flood. Existing
        // buckets retain their limits; new identities retry after the window.
        if (this.buckets.size >= this.maxBuckets) return false
      }
      this.buckets.set(key, { count: 1, resetAt: currentTime + windowMs })
      return true
    }
    current.count += 1
    return current.count <= limit
  }
}
