import { describe, expect, test } from 'vitest'
import { QrCredentials } from '../src/credentials.ts'

describe('QR credentials', () => {
  test('exchanges a token once and validates only the issued session', () => {
    let now = 1_000
    const credentials = new QrCredentials({
      tokenLifetimeMs: 300_000,
      sessionLifetimeMs: 3_600_000,
      now: () => now,
    })
    const issued = credentials.issueQrToken(7)

    expect(issued.expiresAt).toBe(301_000)
    const exchanged = credentials.exchangeQrToken(issued.token, 7)
    expect(exchanged.ok).toBe(true)
    if (!exchanged.ok) throw new Error('expected successful exchange')
    expect(credentials.exchangeQrToken(issued.token, 7)).toEqual({ ok: false, code: 'invalid-token' })
    expect(credentials.validateSession(exchanged.session, 7)).toBe(true)
    expect(credentials.validateSession(`${exchanged.session}x`, 7)).toBe(false)

    now += 3_600_001
    expect(credentials.validateSession(exchanged.session, 7)).toBe(false)
  })

  test('expires tokens and binds credentials to one tunnel generation', () => {
    let now = 5_000
    const credentials = new QrCredentials({
      tokenLifetimeMs: 100,
      sessionLifetimeMs: 1_000,
      now: () => now,
    })
    const wrongGeneration = credentials.issueQrToken(2)
    expect(credentials.exchangeQrToken(wrongGeneration.token, 3))
      .toEqual({ ok: false, code: 'invalid-token' })

    const expired = credentials.issueQrToken(3)
    now += 101
    expect(credentials.exchangeQrToken(expired.token, 3))
      .toEqual({ ok: false, code: 'invalid-token' })
  })

  test('invalidates old generation records and clears all state', () => {
    const credentials = new QrCredentials({ tokenLifetimeMs: 100, sessionLifetimeMs: 1_000 })
    const token = credentials.issueQrToken(4)
    const exchange = credentials.exchangeQrToken(token.token, 4)
    if (!exchange.ok) throw new Error('expected successful exchange')
    credentials.issueQrToken(4)

    credentials.invalidateGeneration(4)
    expect(credentials.validateSession(exchange.session, 4)).toBe(false)
    expect(credentials.counts()).toEqual({ tokens: 0, sessions: 0 })

    credentials.issueQrToken(5)
    credentials.clear()
    expect(credentials.counts()).toEqual({ tokens: 0, sessions: 0 })
  })
})
