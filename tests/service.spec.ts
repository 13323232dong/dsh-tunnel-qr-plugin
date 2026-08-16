import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, test, vi } from 'vitest'
import { QrCredentials } from '../src/credentials.ts'
import { createQrResponse, TunnelQrService } from '../src/service.ts'

type OwnedService = TunnelQrService & {
  manager: { dispose(): Promise<void> }
  proxy: { close(): Promise<void> }
  credentials: { clear(): void }
}

describe('QR response creation', () => {
  test('puts the single-use token in a fragment and renders a PNG data URL', async () => {
    const credentials = new QrCredentials({ tokenLifetimeMs: 300_000, sessionLifetimeMs: 1_000 })
    const response = await createQrResponse(
      'https://sample.trycloudflare.com', 4, credentials,
    )

    expect(response.loginUrl).toMatch(/^https:\/\/sample\.trycloudflare\.com\/dsh-qr-login#[A-Za-z0-9_-]+$/)
    expect(response.qrDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(response.generation).toBe(4)
    expect(response.publicUrl).toBe('https://sample.trycloudflare.com')
  })
})

describe('TunnelQrService lifecycle', () => {
  test('fiber disposal waits for manager then proxy before clearing credentials', async () => {
    const ctx = new Context()
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const initializeRuntime = vi.spyOn(
      TunnelQrService.prototype as unknown as { initializeRuntime(): Promise<void> },
      'initializeRuntime',
    ).mockResolvedValue()
    const fiber = await ctx.plugin(TunnelQrService)
    const service = (ctx as unknown as { tunnelQr: TunnelQrService }).tunnelQr as OwnedService
    let releaseManager!: () => void
    let releaseProxy!: () => void
    const managerDisposed = new Promise<void>(resolve => { releaseManager = resolve })
    const proxyClosed = new Promise<void>(resolve => { releaseProxy = resolve })
    const order: string[] = []
    service.manager = {
      dispose: vi.fn(async () => {
        order.push('manager:start')
        await managerDisposed
        order.push('manager:end')
      }),
    }
    service.proxy = {
      close: vi.fn(async () => {
        order.push('proxy:start')
        await proxyClosed
        order.push('proxy:end')
      }),
    }
    service.credentials = {
      clear: vi.fn(() => { order.push('credentials:clear') }),
    }

    let disposed = false
    const pending = fiber.dispose().then(() => { disposed = true })

    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(order).toEqual(['manager:start'])
    expect(disposed).toBe(false)
    releaseManager()
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['manager:start', 'manager:end', 'proxy:start'])
    expect(disposed).toBe(false)
    releaseProxy()
    await pending
    expect(order).toEqual(['manager:start', 'manager:end', 'proxy:start', 'proxy:end', 'credentials:clear'])
    expect(disposed).toBe(true)

    initializeRuntime.mockRestore()
    await ctx.fiber.dispose()
  })

  test('rejects invalid plugin config before startup side effects', () => {
    expect(() => new TunnelQrService(new Context(), {
      restartBackoffMinMs: 10,
      restartBackoffMaxMs: 5,
    })).toThrow(/restartBackoffMaxMs/)
    expect(() => new TunnelQrService(new Context(), {
      binaryCacheDirectory: '',
    })).toThrow(/binaryCacheDirectory/)
    expect(() => new TunnelQrService(new Context(), {
      cloudflaredVersion: '',
    })).toThrow(/cloudflaredVersion/)
  })
})
