import { describe, expect, test } from 'vitest'
import { DEFAULT_TUNNEL_CONFIG, resolveTunnelConfig } from '../src/config.ts'

describe('tunnel configuration', () => {
  test('provides non-interactive bounded defaults', () => {
    expect(DEFAULT_TUNNEL_CONFIG).toEqual({
      cloudflaredVersion: '2026.8.2',
      downloadTimeoutMs: 30_000,
      tunnelStartupTimeoutMs: 30_000,
      qrTokenLifetimeMs: 5 * 60_000,
      publicSessionLifetimeMs: 24 * 60 * 60_000,
      restartLimit: 5,
      restartBackoffMinMs: 1_000,
      restartBackoffMaxMs: 30_000,
      binaryCacheDirectory: undefined,
    })
  })

  test('returns a new frozen object with explicit overrides', () => {
    const resolved = resolveTunnelConfig({ restartLimit: 2, downloadTimeoutMs: 4_000 })

    expect(resolved).not.toBe(DEFAULT_TUNNEL_CONFIG)
    expect(resolved.restartLimit).toBe(2)
    expect(resolved.downloadTimeoutMs).toBe(4_000)
    expect(Object.isFrozen(resolved)).toBe(true)
  })

  test('rejects invalid ranges at the configuration boundary', () => {
    expect(() => resolveTunnelConfig({ restartLimit: -1 })).toThrow(/restartLimit/)
    expect(() => resolveTunnelConfig({ qrTokenLifetimeMs: 0 })).toThrow(/qrTokenLifetimeMs/)
    expect(() => resolveTunnelConfig({ restartBackoffMinMs: 10, restartBackoffMaxMs: 5 }))
      .toThrow(/restartBackoffMaxMs/)
  })
})
