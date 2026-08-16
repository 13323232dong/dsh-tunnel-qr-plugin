import { randomBytes } from 'node:crypto'
import {
  createServer, request as httpRequest,
} from 'node:http'
import type {
  IncomingHttpHeaders, IncomingMessage, Server, ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import type { QrCredentials } from './credentials.js'
import { renderLandingPage } from './landing-page.js'
import type { FixedWindowRateLimiter } from './rate-limit.js'

const COOKIE_NAME = 'dsh_tunnel_session'
const MAX_LOGIN_BODY_BYTES = 2_048
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])

export interface AuthenticationProxyOptions {
  readonly targetHost: string
  readonly targetPort: number
  readonly credentials: QrCredentials
  readonly generation: () => number
  readonly limiter: FixedWindowRateLimiter
  readonly sessionLifetimeMs: number
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
  })
  response.end(body)
}

function unauthorized(response: ServerResponse): void {
  json(response, 401, { error: 'authentication-required' })
}

function cookieValue(request: IncomingMessage): string | undefined {
  for (const part of request.headers.cookie?.split(';') ?? []) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() === COOKIE_NAME) return part.slice(separator + 1).trim()
  }
  return undefined
}

function withoutAuthCookie(value: string | undefined): string | undefined {
  const retained = value?.split(';').filter(part => part.trim().split('=', 1)[0] !== COOKIE_NAME)
  return retained === undefined || retained.length === 0 ? undefined : retained.join(';')
}

function targetHeaders(request: IncomingMessage, targetHost: string, targetPort: number): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {}
  const connectionTokens = new Set(
    request.headers.connection?.split(',').map(value => value.trim().toLowerCase()).filter(Boolean) ?? [],
  )
  for (const [name, value] of Object.entries(request.headers)) {
    if (HOP_BY_HOP.has(name) || connectionTokens.has(name) || name === 'host' || name === 'origin') continue
    if (value !== undefined) headers[name] = value
  }
  const authority = `${targetHost}:${targetPort}`
  headers.host = authority
  if (request.headers.origin !== undefined) headers.origin = `http://${authority}`
  const cookies = withoutAuthCookie(request.headers.cookie)
  if (cookies === undefined) delete headers.cookie
  else headers.cookie = cookies
  return headers
}

function safeResponseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name) && value !== undefined) result[name] = value
  }
  return result
}

async function readLoginToken(request: IncomingMessage): Promise<string> {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw Object.assign(new Error('content type'), { status: 400 })
  }
  const declaredLength = Number(request.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LOGIN_BODY_BYTES) {
    throw Object.assign(new Error('body too large'), { status: 413 })
  }
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.byteLength
    if (length > MAX_LOGIN_BODY_BYTES) throw Object.assign(new Error('body too large'), { status: 413 })
    chunks.push(buffer)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (typeof value !== 'object' || value === null || typeof (value as { token?: unknown }).token !== 'string') {
      throw new Error('invalid token')
    }
    const token = (value as { token: string }).token
    if (token.length < 32 || token.length > 128) throw new Error('invalid token')
    return token
  } catch {
    throw Object.assign(new Error('invalid json'), { status: 400 })
  }
}

/** Loopback-only authentication and reverse proxy in front of the DSH Web server. */
export class AuthenticationProxy {
  private server: Server | undefined
  private readonly sockets = new Set<Duplex>()

  constructor(private readonly options: AuthenticationProxyOptions) {}

  /** Bind the proxy and return its OS-assigned loopback port. */
  async start(): Promise<number> {
    if (this.server !== undefined) throw new Error('authentication proxy already started')
    const server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.headersSent) json(response, 400, { error: 'invalid-request' })
        else response.destroy()
      })
    })
    this.server = server
    server.on('connection', socket => {
      this.sockets.add(socket)
      socket.once('close', () => { this.sockets.delete(socket) })
    })
    server.on('upgrade', (request, socket, head) => { this.handleUpgrade(request, socket, head) })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    return (server.address() as AddressInfo).port
  }

  private isAuthenticated(request: IncomingMessage): boolean {
    const value = cookieValue(request)
    return value !== undefined && this.options.credentials.validateSession(value, this.options.generation())
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', 'http://proxy').pathname
    if (path === '/dsh-qr-login' && request.method === 'GET') {
      const nonce = randomBytes(18).toString('base64')
      const body = renderLandingPage(nonce)
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      })
      response.end(body)
      return
    }
    if (path === '/dsh-qr-login' && request.method === 'POST') {
      const source = request.socket.remoteAddress ?? 'unknown'
      if (!this.options.limiter.allow(source)) {
        json(response, 429, { error: 'rate-limited' })
        return
      }
      let token: string
      try {
        token = await readLoginToken(request)
      } catch (error) {
        json(response, (error as { status?: number }).status ?? 400, { error: 'invalid-request' })
        return
      }
      const exchange = this.options.credentials.exchangeQrToken(token, this.options.generation())
      if (!exchange.ok) {
        json(response, 401, { error: exchange.code })
        return
      }
      response.writeHead(204, {
        'cache-control': 'no-store',
        'set-cookie': `${COOKIE_NAME}=${exchange.session}; Path=/; Max-Age=${Math.floor(this.options.sessionLifetimeMs / 1_000)}; HttpOnly; Secure; SameSite=Strict`,
      })
      response.end()
      return
    }
    if (path === '/dsh-qr-login') {
      response.writeHead(405, { allow: 'GET, POST', 'cache-control': 'no-store' })
      response.end()
      return
    }
    if (!this.isAuthenticated(request)) {
      unauthorized(response)
      return
    }
    this.forwardHttp(request, response)
  }

  private forwardHttp(request: IncomingMessage, response: ServerResponse): void {
    const upstream = httpRequest({
      host: this.options.targetHost,
      port: this.options.targetPort,
      method: request.method,
      path: request.url,
      headers: targetHeaders(request, this.options.targetHost, this.options.targetPort),
    }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode ?? 502, safeResponseHeaders(upstreamResponse.headers))
      upstreamResponse.pipe(response)
    })
    upstream.on('error', () => {
      if (response.headersSent) response.destroy()
      else json(response, 503, { error: 'target-unavailable' })
    })
    request.pipe(upstream)
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.isAuthenticated(request)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    const headers = targetHeaders(request, this.options.targetHost, this.options.targetPort)
    headers.connection = 'Upgrade'
    headers.upgrade = request.headers.upgrade ?? 'websocket'
    const upstreamRequest = httpRequest({
      host: this.options.targetHost,
      port: this.options.targetPort,
      method: request.method,
      path: request.url,
      headers,
    })
    upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      const responseHeaders = Object.entries(upstreamResponse.headers)
        .filter(([name]) => !HOP_BY_HOP.has(name))
        .flatMap(([name, value]) => value === undefined ? [] : [`${name}: ${Array.isArray(value) ? value.join(', ') : value}`])
      socket.write(`HTTP/1.1 ${upstreamResponse.statusCode ?? 101} Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: ${upstreamResponse.headers.upgrade ?? 'websocket'}\r\n${responseHeaders.join('\r\n')}\r\n\r\n`)
      if (upstreamHead.byteLength > 0) socket.write(upstreamHead)
      if (head.byteLength > 0) upstreamSocket.write(head)
      socket.once('close', () => { upstreamSocket.destroy() })
      upstreamSocket.once('close', () => { socket.destroy() })
      socket.pipe(upstreamSocket).pipe(socket)
    })
    upstreamRequest.on('response', () => { socket.destroy() })
    upstreamRequest.on('error', () => { socket.destroy() })
    upstreamRequest.end()
  }

  /** Stop accepting traffic and destroy every owned HTTP or upgraded socket. */
  async close(): Promise<void> {
    const server = this.server
    if (server === undefined) return
    this.server = undefined
    for (const socket of this.sockets) socket.destroy()
    await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    this.options.credentials.clear()
  }
}
