import { describe, expect, test } from 'vitest'
import type { TunnelProcess } from '../src/tunnel-process.ts'
import { TunnelManager } from '../src/tunnel-manager.ts'

class FakeProcess implements TunnelProcess {
  private listener: ((line: string) => void) | undefined
  private readonly exitPromise: Promise<{ readonly code: number | null; readonly signal: string | null }>
  private resolveExit!: (value: { readonly code: number | null; readonly signal: string | null }) => void
  stopped = false

  constructor(lines: readonly string[] = []) {
    this.exitPromise = new Promise(resolve => { this.resolveExit = resolve })
    queueMicrotask(() => { for (const line of lines) this.listener?.(line) })
  }

  onLine(listener: (line: string) => void): () => void {
    this.listener = listener
    return () => { this.listener = undefined }
  }

  get exited(): Promise<{ readonly code: number | null; readonly signal: string | null }> {
    return this.exitPromise
  }

  diagnostics(): readonly string[] { return [] }

  stop(): Promise<void> {
    this.stopped = true
    this.resolveExit({ code: null, signal: 'SIGTERM' })
    return Promise.resolve()
  }

  exit(code = 1): void { this.resolveExit({ code, signal: null }) }
}

describe('TunnelManager', () => {
  test('publishes a ready URL and advances generation', async () => {
    const process = new FakeProcess(['https://sample.trycloudflare.com'])
    const manager = new TunnelManager({
      executable: '/tmp/cloudflared', proxyPort: 4010, startupTimeoutMs: 1_000,
      restartLimit: 1, restartBackoffMinMs: 1, restartBackoffMaxMs: 2,
      spawn: () => process, sleep: async () => {},
    })
    await manager.start()
    expect(manager.getSnapshot()).toMatchObject({ status: 'ready', generation: 1, publicUrl: 'https://sample.trycloudflare.com' })
    await manager.dispose()
    expect(process.stopped).toBe(true)
  })

  test('reconnects after an unexpected exit and then stops at the retry limit', async () => {
    const processes: FakeProcess[] = []
    const manager = new TunnelManager({
      executable: '/tmp/cloudflared', proxyPort: 4010, startupTimeoutMs: 1_000,
      restartLimit: 1, restartBackoffMinMs: 1, restartBackoffMaxMs: 2,
      spawn: () => {
        const process = new FakeProcess(['https://sample.trycloudflare.com'])
        processes.push(process)
        if (processes.length === 1) queueMicrotask(() => process.exit())
        return process
      }, sleep: async () => {},
    })
    await manager.start()
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    expect(processes).toHaveLength(2)
    expect(manager.getSnapshot().status).toBe('ready')
    await manager.dispose()
  })

  test('does not restart after disposal', async () => {
    let starts = 0
    const process = new FakeProcess()
    const manager = new TunnelManager({
      executable: '/tmp/cloudflared', proxyPort: 4010, startupTimeoutMs: 5,
      restartLimit: 2, restartBackoffMinMs: 1, restartBackoffMaxMs: 2,
      spawn: () => { starts += 1; return process }, sleep: async () => {},
    })
    const starting = manager.start().catch(() => {})
    await manager.dispose()
    await starting
    expect(starts).toBe(1)
  })
})
