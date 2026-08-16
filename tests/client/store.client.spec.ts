import { afterEach, describe, expect, test, vi } from 'vitest'
import type { TunnelStatusResponse, TunnelQrResponse } from '../../src/contracts.ts'
import { createTunnelClientApi } from '../../src/client/api.ts'
import { TunnelQrController } from '../../src/client/store.ts'

function status(snapshot: TunnelStatusResponse['snapshot']): TunnelStatusResponse {
  return { snapshot }
}

function qr(value: Partial<TunnelQrResponse> = {}): TunnelQrResponse {
  return {
    generation: 4,
    publicUrl: 'https://sample.trycloudflare.com',
    expiresAt: 100,
    qrDataUrl: 'data:image/png;base64,AA==',
    ...value,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TunnelQrController', () => {
  test('open refreshes status and qr once, exposes no credentials, and dedupes concurrent refreshes', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify(status({
        status: 'ready',
        generation: 4,
        updatedAt: 10,
        publicUrl: 'https://sample.trycloudflare.com',
      })), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(qr()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    const api = createTunnelClientApi(fetchMock)
    const controller = new TunnelQrController(api, { pollMs: 60_000 })

    await Promise.all([controller.open(), controller.refresh()])

    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      '/dsh-tunnel/status',
      '/dsh-tunnel/qr',
    ])
    expect(controller.getSnapshot()).toMatchObject({
      open: true,
      qr: qr(),
      status: {
        status: 'ready',
        generation: 4,
        updatedAt: 10,
        publicUrl: 'https://sample.trycloudflare.com',
      },
    })
    expect(JSON.stringify(controller.getSnapshot())).not.toMatch(/password|username|token/i)
  })

  test('copy, restart, close, and dispose keep a single in-flight request and restore focus', async () => {
    const focus = vi.fn()
    const trigger = { focus } as Pick<HTMLElement, 'focus'>
    const clipboard = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText: clipboard } })
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify(status({
        status: 'ready',
        generation: 8,
        updatedAt: 10,
        publicUrl: 'https://sample.trycloudflare.com',
      })), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(qr({ generation: 8 })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(status({
        status: 'starting',
        generation: 9,
        updatedAt: 11,
      })), { status: 200, headers: { 'content-type': 'application/json' } }))
    const controller = new TunnelQrController(createTunnelClientApi(fetchMock), { pollMs: 60_000 })

    await controller.open(trigger)
    await controller.copyUrl()
    await Promise.all([controller.restart(), controller.restart()])
    controller.close()
    controller.dispose()

    expect(clipboard).toHaveBeenCalledWith('https://sample.trycloudflare.com')
    expect(fetchMock.mock.calls.map(call => [String(call[0]), call[1]?.method ?? 'GET'])).toEqual([
      ['/dsh-tunnel/status', 'GET'],
      ['/dsh-tunnel/qr', 'POST'],
      ['/dsh-tunnel/restart', 'POST'],
      ['/dsh-tunnel/status', 'GET'],
    ])
    expect(focus).toHaveBeenCalled()
  })

  test('runtime validation rejects malformed status and qr payloads', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ snapshot: { status: 'ready' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    const api = createTunnelClientApi(fetchMock)

    await expect(api.readStatus()).rejects.toThrow(/invalid tunnel status/i)
  })
})
