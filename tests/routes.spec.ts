import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, test } from 'vitest'
import type { TunnelQrResponse, TunnelSnapshot } from '../src/contracts.ts'
import { registerTunnelRoutes } from '../src/routes.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

async function setup(snapshot: TunnelSnapshot): Promise<{
  readonly baseUrl: string
  readonly calls: { qr: number; restart: number }
}> {
  context = new Context()
  await context.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const calls = { qr: 0, restart: 0 }
  registerTunnelRoutes(context.webServer, {
    getSnapshot: () => snapshot,
    createQr: async (): Promise<TunnelQrResponse> => {
      calls.qr += 1
      return {
        generation: 1, publicUrl: 'https://sample.trycloudflare.com', expiresAt: 10,
        loginUrl: 'https://sample.trycloudflare.com/dsh-qr-login#token',
        qrDataUrl: 'data:image/png;base64,AA==',
      }
    },
    restart: async () => { calls.restart += 1 },
  })
  return { baseUrl: `http://127.0.0.1:${context.webServer.port}`, calls }
}

describe('tunnel Host routes', () => {
  test('returns no-store status and enforces methods', async () => {
    const snapshot: TunnelSnapshot = { status: 'starting', generation: 0, updatedAt: 1 }
    const { baseUrl } = await setup(snapshot)
    const status = await fetch(`${baseUrl}/dsh-tunnel/status`)
    expect(status.status).toBe(200)
    expect(status.headers.get('cache-control')).toBe('no-store')
    expect(await status.json()).toEqual({ snapshot })
    expect((await fetch(`${baseUrl}/dsh-tunnel/status`, { method: 'POST' })).status).toBe(405)
  })

  test('creates fresh QR material and restarts through POST actions', async () => {
    const { baseUrl, calls } = await setup({
      status: 'ready', generation: 1, updatedAt: 1, publicUrl: 'https://sample.trycloudflare.com',
    })
    const qr = await fetch(`${baseUrl}/dsh-tunnel/qr`, { method: 'POST' })
    expect(qr.status).toBe(200)
    expect(await qr.json()).toMatchObject({ qrDataUrl: 'data:image/png;base64,AA==' })
    expect((await fetch(`${baseUrl}/dsh-tunnel/restart`, { method: 'POST' })).status).toBe(204)
    expect(calls).toEqual({ qr: 1, restart: 1 })
  })
})
