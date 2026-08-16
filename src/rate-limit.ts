interface RateLimiterOptions {
  readonly perSourceLimit: number
  readonly globalLimit: number
  readonly windowMs: number
  readonly maxSources: number
  readonly now?: () => number
}

interface WindowRecord {
  readonly startedAt: number
  readonly count: number
}

function positiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`)
}

/** Bounded fixed-window limiter for the public QR exchange endpoint. */
export class FixedWindowRateLimiter {
  private readonly options: Required<Omit<RateLimiterOptions, 'now'>>
  private readonly now: () => number
  private readonly sources = new Map<string, WindowRecord>()
  private global: WindowRecord

  constructor(options: RateLimiterOptions) {
    positiveInteger('perSourceLimit', options.perSourceLimit)
    positiveInteger('globalLimit', options.globalLimit)
    positiveInteger('windowMs', options.windowMs)
    positiveInteger('maxSources', options.maxSources)
    this.options = options
    this.now = options.now ?? Date.now
    this.global = { startedAt: this.now(), count: 0 }
  }

  /** Consume one attempt when both the source and global windows permit it. */
  allow(source: string): boolean {
    const now = this.now()
    this.pruneExpired(now)
    this.global = this.currentWindow(this.global, now)
    const sourceWindow = this.currentWindow(this.sources.get(source), now)
    if (sourceWindow.count >= this.options.perSourceLimit
      || this.global.count >= this.options.globalLimit) return false

    if (!this.sources.has(source) && this.sources.size >= this.options.maxSources) {
      const oldest = this.sources.keys().next().value as string | undefined
      if (oldest !== undefined) this.sources.delete(oldest)
    }
    this.sources.delete(source)
    this.sources.set(source, { startedAt: sourceWindow.startedAt, count: sourceWindow.count + 1 })
    this.global = { startedAt: this.global.startedAt, count: this.global.count + 1 }
    return true
  }

  /** Number of source windows retained for bounded-memory diagnostics. */
  sourceCount(): number {
    this.pruneExpired(this.now())
    return this.sources.size
  }

  private currentWindow(record: WindowRecord | undefined, now: number): WindowRecord {
    return record === undefined || now - record.startedAt >= this.options.windowMs
      ? { startedAt: now, count: 0 }
      : record
  }

  private pruneExpired(now: number): void {
    for (const [source, record] of this.sources) {
      if (now - record.startedAt >= this.options.windowMs) this.sources.delete(source)
    }
  }
}
