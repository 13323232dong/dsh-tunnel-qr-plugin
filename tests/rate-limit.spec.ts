import { describe, expect, test } from 'vitest'
import { FixedWindowRateLimiter } from '../src/rate-limit.ts'

describe('login rate limiter', () => {
  test('enforces per-source and global fixed-window budgets', () => {
    let now = 1_000
    const limiter = new FixedWindowRateLimiter({
      perSourceLimit: 2, globalLimit: 3, windowMs: 100, maxSources: 10, now: () => now,
    })

    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(false)
    expect(limiter.allow('b')).toBe(true)
    expect(limiter.allow('c')).toBe(false)

    now += 101
    expect(limiter.allow('a')).toBe(true)
  })

  test('keeps source accounting bounded under address churn', () => {
    const limiter = new FixedWindowRateLimiter({
      perSourceLimit: 1, globalLimit: 100, windowMs: 1_000, maxSources: 3,
    })
    for (let index = 0; index < 20; index += 1) expect(limiter.allow(`source-${index}`)).toBe(true)
    expect(limiter.sourceCount()).toBeLessThanOrEqual(3)
  })

  test('rejects invalid limiter configuration', () => {
    expect(() => new FixedWindowRateLimiter({
      perSourceLimit: 0, globalLimit: 1, windowMs: 1, maxSources: 1,
    })).toThrow(/perSourceLimit/)
  })
})
