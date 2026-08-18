import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply } from '../../src/client/index.ts'
import { buildTunnelQrOverlayView } from '../../src/client/TunnelQrOverlay.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tunnel qr overlay registration', () => {
  test('registers into shell.overlay with the fixed trigger and no credential labels', () => {
    const registered: { options?: Record<string, unknown>; component?: unknown } = {}
    const cleanups: Array<() => void> = []
    const ctx = {
      effect(factory: () => () => void) {
        cleanups.push(factory())
      },
      slots: {
        inject(_key: string, callback: () => () => void) {
          cleanups.push(callback())
          return () => undefined
        },
        register(options: Record<string, unknown>, component: unknown) {
          registered.options = options
          registered.component = component
          return () => undefined
        },
      },
    } as unknown as ClientContext

    apply(ctx)

    expect(registered.options).toMatchObject({ name: 'shell.overlay', id: 'tunnel-qr', order: 100 })
    const view = buildTunnelQrOverlayView({
      open: false,
      busy: 'idle',
      status: { status: 'starting', generation: 1, updatedAt: 1 },
      qr: null,
      error: null,
      copyState: 'idle',
    }, {
      open: vi.fn(),
      close: vi.fn(),
      refresh: vi.fn(),
      handleKeyDown: vi.fn(),
      handleBackdrop: vi.fn(),
    })
    const text = JSON.stringify(view)
    const button = Array.isArray(view.props.children) ? view.props.children[0] : null
    expect(text).toContain('公网访问二维码')
    expect(button?.props.style.right).toBe('16px')
    expect(button?.props.style.bottom).toBe('18px')
    expect(text).not.toMatch(/账号|密码|username|password|token/i)
    for (const dispose of cleanups.reverse()) dispose()
  })

  test('opens automatically after the client plugin mounts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      snapshot: { status: 'starting', generation: 0, updatedAt: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const cleanups: Array<() => void> = []
    const ctx = {
      effect(factory: () => () => void) {
        cleanups.push(factory())
      },
      slots: {
        inject(_key: string, callback: () => () => void) {
          cleanups.push(callback())
          return () => undefined
        },
        register() {
          return () => undefined
        },
      },
    } as unknown as ClientContext

    apply(ctx)
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/dsh-tunnel/status', expect.objectContaining({ method: 'GET' }))
    })

    for (const dispose of cleanups.reverse()) dispose()
  })

  test('shows only QR refresh and close controls for a ready tunnel', () => {
    const view = buildTunnelQrOverlayView({
      open: true,
      busy: 'idle',
      status: {
        status: 'ready',
        generation: 1,
        updatedAt: 1,
        publicUrl: 'https://sample.trycloudflare.com',
      },
      qr: {
        generation: 1,
        publicUrl: 'https://sample.trycloudflare.com',
        expiresAt: 10,
        qrDataUrl: 'data:image/png;base64,AA==',
      },
      error: null,
      copyState: 'idle',
    }, {
      open: vi.fn(),
      close: vi.fn(),
      refresh: vi.fn(),
      handleKeyDown: vi.fn(),
      handleBackdrop: vi.fn(),
    })

    const text = JSON.stringify(view)
    expect(text).toContain('刷新二维码')
    expect(text).not.toContain('sample.trycloudflare.com')
    expect(text).not.toMatch(/复制|重启/)
  })
})
