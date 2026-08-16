import type { TunnelFailureCode, TunnelQrResponse, TunnelSnapshot, TunnelStatusResponse } from './contracts.js'

export interface TunnelClientApi {
  readStatus(signal?: AbortSignal): Promise<TunnelStatusResponse>
  readFreshQr(signal?: AbortSignal): Promise<TunnelQrResponse>
  restart(signal?: AbortSignal): Promise<void>
}

interface FetchLike {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

const STATUS_PATH = '/dsh-tunnel/status'
const QR_PATH = '/dsh-tunnel/qr'
const RESTART_PATH = '/dsh-tunnel/restart'

export function createTunnelClientApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): TunnelClientApi {
  return {
    async readStatus(signal) {
      return parseStatusResponse(await requestJson(fetcher, STATUS_PATH, { method: 'GET', signal }))
    },
    async readFreshQr(signal) {
      return parseQrResponse(await requestJson(fetcher, QR_PATH, { method: 'POST', signal }))
    },
    async restart(signal) {
      const response = await fetcher(RESTART_PATH, { method: 'POST', signal })
      if (!response.ok) throw new Error(`tunnel restart failed: HTTP ${response.status}`)
    },
  }
}

async function requestJson(fetcher: FetchLike, input: string, init: RequestInit): Promise<unknown> {
  const response = await fetcher(input, {
    ...init,
    headers: {
      accept: 'application/json',
      ...init.headers ?? {},
    },
  })
  if (!response.ok) throw new Error(`request failed: HTTP ${response.status}`)
  return await response.json()
}

function parseStatusResponse(value: unknown): TunnelStatusResponse {
  if (!isRecord(value) || !('snapshot' in value)) {
    throw new Error('invalid tunnel status response')
  }
  return { snapshot: parseTunnelSnapshot(value.snapshot) }
}

function parseQrResponse(value: unknown): TunnelQrResponse {
  if (!isRecord(value)
    || typeof value.generation !== 'number'
    || !Number.isSafeInteger(value.generation)
    || typeof value.publicUrl !== 'string'
    || !isHttpUrl(value.publicUrl)
    || typeof value.expiresAt !== 'number'
    || !Number.isFinite(value.expiresAt)
    || typeof value.qrDataUrl !== 'string'
    || !value.qrDataUrl.startsWith('data:image/')) {
    throw new Error('invalid tunnel qr response')
  }
  return {
    generation: value.generation,
    publicUrl: value.publicUrl,
    expiresAt: value.expiresAt,
    qrDataUrl: value.qrDataUrl,
  }
}

function parseTunnelSnapshot(value: unknown): TunnelSnapshot {
  if (!isRecord(value)
    || typeof value.status !== 'string'
    || typeof value.generation !== 'number'
    || !Number.isSafeInteger(value.generation)
    || typeof value.updatedAt !== 'number'
    || !Number.isFinite(value.updatedAt)) {
    throw new Error('invalid tunnel status snapshot')
  }
  switch (value.status) {
    case 'starting':
      return {
        status: 'starting',
        generation: value.generation,
        updatedAt: value.updatedAt,
      }
    case 'ready':
      if (typeof value.publicUrl !== 'string' || !isHttpUrl(value.publicUrl)) throw new Error('invalid tunnel status snapshot')
      return {
        status: 'ready',
        generation: value.generation,
        updatedAt: value.updatedAt,
        publicUrl: value.publicUrl,
      }
    case 'reconnecting':
      if (typeof value.attempt !== 'number' || !Number.isSafeInteger(value.attempt)) throw new Error('invalid tunnel status snapshot')
      return {
        status: 'reconnecting',
        generation: value.generation,
        updatedAt: value.updatedAt,
        attempt: value.attempt,
      }
    case 'failed':
      if (typeof value.code !== 'string' || typeof value.message !== 'string' || typeof value.retryable !== 'boolean') {
        throw new Error('invalid tunnel status snapshot')
      }
      return {
        status: 'failed',
        generation: value.generation,
        updatedAt: value.updatedAt,
        code: value.code as Exclude<TunnelFailureCode, 'unsupported-platform'>,
        message: value.message,
        retryable: value.retryable,
      }
    case 'unsupported':
      if (value.code !== 'unsupported-platform' || typeof value.message !== 'string') throw new Error('invalid tunnel status snapshot')
      return {
        status: 'unsupported',
        generation: value.generation,
        updatedAt: value.updatedAt,
        code: value.code,
        message: value.message,
      }
    default:
      throw new Error('invalid tunnel status snapshot')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
