import type { TunnelQrResponse, TunnelSnapshot } from './contracts.js'
import type { TunnelClientApi } from './api.js'

export type CopyState = 'idle' | 'copied' | 'failed'
export type BusyState = 'idle' | 'refreshing' | 'restarting'

export interface TunnelQrOverlayState {
  readonly open: boolean
  readonly busy: BusyState
  readonly status: TunnelSnapshot | null
  readonly qr: TunnelQrResponse | null
  readonly error: string | null
  readonly copyState: CopyState
}

export interface TunnelQrControllerOptions {
  readonly pollMs?: number
}

interface FocusTarget {
  focus(): void
}

const DEFAULT_POLL_MS = 15_000

export class TunnelQrController {
  private snapshot: TunnelQrOverlayState = {
    open: false,
    busy: 'idle',
    status: null,
    qr: null,
    error: null,
    copyState: 'idle',
  }
  private readonly listeners = new Set<() => void>()
  private readonly pollMs: number
  private pollHandle: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private activeAbort: AbortController | null = null
  private disposed = false
  private restoreFocus: FocusTarget | null = null

  constructor(
    private readonly api: TunnelClientApi,
    options: TunnelQrControllerOptions = {},
  ) {
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): TunnelQrOverlayState => this.snapshot

  async open(target?: FocusTarget | null): Promise<void> {
    if (target !== undefined) this.restoreFocus = target
    if (!this.snapshot.open) this.publish({ ...this.snapshot, open: true, copyState: 'idle' })
    await this.refresh()
  }

  close(): void {
    if (!this.snapshot.open) return
    this.clearPoll()
    this.publish({ ...this.snapshot, open: false, busy: 'idle', copyState: 'idle' })
    this.restoreFocus?.focus()
  }

  handleBackdrop = (): void => {
    this.close()
  }

  handleKeyDown = (event: Pick<KeyboardEvent, 'key'>): void => {
    if (event.key === 'Escape') this.close()
  }

  async refresh(): Promise<void> {
    await this.runExclusive('refreshing', async (signal) => {
      const nextStatus = await this.api.readStatus(signal)
      const nextQr = nextStatus.snapshot.status === 'ready'
        ? await this.api.readFreshQr(signal)
        : null
      if (signal.aborted || this.disposed) return
      this.publish({
        ...this.snapshot,
        busy: 'idle',
        error: null,
        open: true,
        status: nextStatus.snapshot,
        qr: nextQr,
      })
      this.schedulePoll()
    })
  }

  async restart(): Promise<void> {
    await this.runExclusive('restarting', async (signal) => {
      await this.api.restart(signal)
      if (signal.aborted || this.disposed) return
      this.publish({
        ...this.snapshot,
        busy: 'restarting',
        copyState: 'idle',
        qr: null,
        error: null,
      })
      const nextStatus = await this.api.readStatus(signal)
      if (signal.aborted || this.disposed) return
      this.publish({
        ...this.snapshot,
        busy: 'idle',
        status: nextStatus.snapshot,
        error: null,
      })
      this.schedulePoll()
    })
  }

  async copyUrl(): Promise<void> {
    const url = this.snapshot.qr?.publicUrl
      ?? (this.snapshot.status?.status === 'ready' ? this.snapshot.status.publicUrl : null)
    if (typeof url !== 'string') return
    try {
      await globalThis.navigator?.clipboard?.writeText(url)
      this.publish({ ...this.snapshot, copyState: 'copied' })
    } catch {
      this.publish({ ...this.snapshot, copyState: 'failed' })
    }
  }

  dispose(): void {
    this.disposed = true
    this.clearPoll()
    this.activeAbort?.abort()
    this.listeners.clear()
  }

  private async runExclusive(
    busy: BusyState,
    work: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (this.inFlight !== null) return this.inFlight
    const controller = new AbortController()
    this.activeAbort = controller
    this.publish({ ...this.snapshot, busy, error: null })
    const task = work(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted || this.disposed) return
      const message = error instanceof Error ? error.message : 'Tunnel request failed'
      this.publish({ ...this.snapshot, busy: 'idle', error: message })
    }).finally(() => {
      if (this.inFlight === task) this.inFlight = null
      if (this.activeAbort === controller) this.activeAbort = null
      if (!this.disposed) {
        this.publish({ ...this.snapshot, busy: 'idle' })
        this.schedulePoll()
      }
    })
    this.inFlight = task
    return task
  }

  private schedulePoll(): void {
    this.clearPoll()
    if (!this.snapshot.open || this.disposed) return
    this.pollHandle = setTimeout(() => {
      this.pollHandle = null
      if (this.inFlight === null) void this.refresh()
    }, this.pollMs)
  }

  private clearPoll(): void {
    if (this.pollHandle !== null) clearTimeout(this.pollHandle)
    this.pollHandle = null
  }

  private publish(next: TunnelQrOverlayState): void {
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}
