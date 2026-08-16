import { describe, expect, test } from 'vitest'
import { parseQuickTunnelUrl } from '../src/tunnel-process.ts'

describe('Quick Tunnel output', () => {
  test('accepts only HTTPS trycloudflare URLs', () => {
    expect(parseQuickTunnelUrl('INF | + https://sample.trycloudflare.com')).toBe('https://sample.trycloudflare.com')
    expect(parseQuickTunnelUrl('https://sample.trycloudflare.com/path')).toBe('https://sample.trycloudflare.com')
    expect(parseQuickTunnelUrl('https://attacker.example')).toBeUndefined()
    expect(parseQuickTunnelUrl('https://sample.trycloudflare.com.evil.example')).toBeUndefined()
    expect(parseQuickTunnelUrl('http://sample.trycloudflare.com')).toBeUndefined()
  })
})
