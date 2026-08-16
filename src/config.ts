/** Runtime settings for download, authentication, and tunnel recovery. */
export interface TunnelConfig {
  readonly cloudflaredVersion: string
  readonly downloadTimeoutMs: number
  readonly tunnelStartupTimeoutMs: number
  readonly qrTokenLifetimeMs: number
  readonly publicSessionLifetimeMs: number
  readonly restartLimit: number
  readonly restartBackoffMinMs: number
  readonly restartBackoffMaxMs: number
  readonly binaryCacheDirectory: string | undefined
}

/** Defaults used by the credential-free bundle patch. */
export const DEFAULT_TUNNEL_CONFIG: TunnelConfig = Object.freeze({
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

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`)
  }
}

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`)
  }
}

/** Resolve partial plugin input into one validated immutable configuration. */
export function resolveTunnelConfig(input: Partial<TunnelConfig> = {}): TunnelConfig {
  const resolved: TunnelConfig = { ...DEFAULT_TUNNEL_CONFIG, ...input }
  if (resolved.cloudflaredVersion.length === 0) {
    throw new RangeError('cloudflaredVersion must not be empty')
  }
  requirePositiveInteger('downloadTimeoutMs', resolved.downloadTimeoutMs)
  requirePositiveInteger('tunnelStartupTimeoutMs', resolved.tunnelStartupTimeoutMs)
  requirePositiveInteger('qrTokenLifetimeMs', resolved.qrTokenLifetimeMs)
  requirePositiveInteger('publicSessionLifetimeMs', resolved.publicSessionLifetimeMs)
  requireNonNegativeInteger('restartLimit', resolved.restartLimit)
  requirePositiveInteger('restartBackoffMinMs', resolved.restartBackoffMinMs)
  requirePositiveInteger('restartBackoffMaxMs', resolved.restartBackoffMaxMs)
  if (resolved.restartBackoffMaxMs < resolved.restartBackoffMinMs) {
    throw new RangeError('restartBackoffMaxMs must be greater than or equal to restartBackoffMinMs')
  }
  if (resolved.binaryCacheDirectory !== undefined && resolved.binaryCacheDirectory.length === 0) {
    throw new RangeError('binaryCacheDirectory must not be empty')
  }
  return Object.freeze(resolved)
}
