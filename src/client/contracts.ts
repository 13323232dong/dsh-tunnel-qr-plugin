export type TunnelFailureCode =
  | 'address-parse-failed'
  | 'checksum-mismatch'
  | 'download-failed'
  | 'execution-denied'
  | 'proxy-bind-failed'
  | 'startup-timeout'
  | 'target-unavailable'
  | 'tunnel-exited'
  | 'unsupported-platform'

interface TunnelSnapshotBase {
  readonly generation: number
  readonly updatedAt: number
}

export type TunnelSnapshot =
  | (TunnelSnapshotBase & { readonly status: 'starting' })
  | (TunnelSnapshotBase & { readonly status: 'ready'; readonly publicUrl: string })
  | (TunnelSnapshotBase & { readonly status: 'reconnecting'; readonly attempt: number })
  | (TunnelSnapshotBase & {
    readonly status: 'failed'
    readonly code: Exclude<TunnelFailureCode, 'unsupported-platform'>
    readonly message: string
    readonly retryable: boolean
  })
  | (TunnelSnapshotBase & {
    readonly status: 'unsupported'
    readonly code: 'unsupported-platform'
    readonly message: string
  })

export interface TunnelStatusResponse {
  readonly snapshot: TunnelSnapshot
}

export interface TunnelQrResponse {
  readonly generation: number
  readonly publicUrl: string
  readonly expiresAt: number
  readonly qrDataUrl: string
}
