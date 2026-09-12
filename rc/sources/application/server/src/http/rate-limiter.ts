export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): boolean | Promise<boolean>
}

interface Bucket {
  count: number
  resetAt: number
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string, limit: number, windowMs: number): boolean {
    const currentTime = this.now()
    const current = this.buckets.get(key)
    if (!current || current.resetAt <= currentTime) {
      this.buckets.set(key, { count: 1, resetAt: currentTime + windowMs })
      return true
    }
    current.count += 1
    return current.count <= limit
  }
}
