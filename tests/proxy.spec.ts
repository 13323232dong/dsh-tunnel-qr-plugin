import { once } from 'node:events'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { QrCredentials } from '../src/credentials.ts'
import { AuthenticationProxy } from '../src/proxy.ts'
import { FixedWindowRateLimiter } from '../src/rate-limit.ts'

const closers: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(closers.splice(0).reverse().map(close => close()))
})

async function fixtureTarget(): Promise<{ readonly port: number; readonly close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    const body: Buffer[] = []
    for await (const chunk of request) body.push(chunk as Buffer)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      method: request.method,
      url: request.url,
      body: Buffer.concat(body).toString('utf8'),
      host: request.headers.host,
      origin: request.headers.origin,
    }))
  })
  server.on('upgrade', (_request, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    socket.pipe(socket)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('target did not bind')
  return {
    port: address.port,
    close: async () => {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    },
  }
}

async function setup(): Promise<{
  readonly baseUrl: string
  readonly port: number
  readonly credentials: QrCredentials
}> {
  const target = await fixtureTarget()
  closers.push(target.close)
  const credentials = new QrCredentials({ tokenLifetimeMs: 300_000, sessionLifetimeMs: 3_600_000 })
  const proxy = new AuthenticationProxy({
    targetHost: '127.0.0.1',
    targetPort: target.port,
    credentials,
    generation: () => 3,
    limiter: new FixedWindowRateLimiter({
      perSourceLimit: 10, globalLimit: 100, windowMs: 60_000, maxSources: 100,
    }),
    sessionLifetimeMs: 3_600_000,
  })
  const port = await proxy.start()
  closers.push(() => proxy.close())
  return { baseUrl: `http://127.0.0.1:${port}`, port, credentials }
}

async function login(baseUrl: string, credentials: QrCredentials): Promise<string> {
  const token = credentials.issueQrToken(3)
  const response = await fetch(`${baseUrl}/dsh-qr-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: token.token }),
  })
  expect(response.status).toBe(204)
  const cookie = response.headers.get('set-cookie')
  expect(cookie).toMatch(/HttpOnly; Secure; SameSite=Strict/)
  return cookie?.split(';', 1)[0] ?? ''
}

describe('AuthenticationProxy', () => {
  test('serves a self-contained login page and rejects unauthenticated traffic', async () => {
    const { baseUrl } = await setup()
    const denied = await fetch(`${baseUrl}/api/session.history`, { method: 'POST' })
    expect(denied.status).toBe(401)

    const landing = await fetch(`${baseUrl}/dsh-qr-login`)
    expect(landing.status).toBe(200)
    expect(landing.headers.get('content-security-policy')).toMatch(/default-src 'none'/)
    expect(await landing.text()).toContain('location.hash')
  })

  test('exchanges one token and forwards authenticated HTTP with rewritten origin', async () => {
    const { baseUrl, credentials } = await setup()
    const cookie = await login(baseUrl, credentials)
    const response = await fetch(`${baseUrl}/api/session.history?before=5`, {
      method: 'POST',
      headers: { cookie, origin: 'https://public.trycloudflare.com' },
      body: 'request-body',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      method: 'POST', url: '/api/session.history?before=5', body: 'request-body',
      origin: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/),
    })
  })

  test('rejects malformed and oversized login bodies', async () => {
    const { baseUrl } = await setup()
    expect((await fetch(`${baseUrl}/dsh-qr-login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    })).status).toBe(400)
    expect((await fetch(`${baseUrl}/dsh-qr-login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(3_000),
    })).status).toBe(413)
  })

  test('uses the same session cookie for WebSocket upgrades', async () => {
    const { baseUrl, port, credentials } = await setup()
    const cookie = await login(baseUrl, credentials)
    const socket = connect(port, '127.0.0.1')
    closers.push(async () => { socket.destroy() })
    socket.write([
      'GET /events HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Key: dGVzdC1rZXk=',
      'Sec-WebSocket-Version: 13',
      `Cookie: ${cookie}`,
      '', '',
    ].join('\r\n'))
    const [chunk] = await once(socket, 'data') as [Buffer]
    expect(chunk.toString('utf8')).toContain('101 Switching Protocols')
  })
})
