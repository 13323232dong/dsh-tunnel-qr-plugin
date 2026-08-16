import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { TunnelQrResponse, TunnelSnapshot } from './contracts.js'

interface TunnelRouteHandlers {
  readonly getSnapshot: () => TunnelSnapshot
  readonly createQr: () => Promise<TunnelQrResponse>
  readonly restart: () => Promise<void>
}

function sendJson(
  response: Parameters<WebServer['register']>[0]['handler'] extends (req: never, res: infer R) => unknown ? R : never,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    ...headers,
  })
  response.end(body)
}

function methodNotAllowed(
  response: Parameters<WebServer['register']>[0]['handler'] extends (req: never, res: infer R) => unknown ? R : never,
  allow: string,
): void {
  response.writeHead(405, {
    allow,
    'cache-control': 'no-store',
    'content-length': '0',
  })
  response.end()
}

/**
 * Register the plugin-owned tunnel status and QR action routes.
 * @param webServer - host web server service.
 * @param handlers - status and action callbacks owned by the service.
 * @returns disposer removing every exact route.
 */
export function registerTunnelRoutes(
  webServer: WebServer,
  handlers: TunnelRouteHandlers,
): () => void {
  const disposers = [
    webServer.register({
      kind: 'exact',
      path: '/dsh-tunnel/status',
      handler: async (request, response) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          methodNotAllowed(response, 'GET, HEAD')
          return
        }
        const body = JSON.stringify({ snapshot: handlers.getSnapshot() })
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(Buffer.byteLength(body)),
        })
        response.end(request.method === 'HEAD' ? undefined : body)
      },
    }),
    webServer.register({
      kind: 'exact',
      path: '/dsh-tunnel/qr',
      handler: async (request, response) => {
        if (request.method !== 'POST') {
          methodNotAllowed(response, 'POST')
          return
        }
        try {
          sendJson(response, 200, await handlers.createQr())
        } catch {
          sendJson(response, 409, { error: 'tunnel-not-ready' })
        }
      },
    }),
    webServer.register({
      kind: 'exact',
      path: '/dsh-tunnel/restart',
      handler: async (request, response) => {
        if (request.method !== 'POST') {
          methodNotAllowed(response, 'POST')
          return
        }
        try {
          await handlers.restart()
          response.writeHead(204, {
            'cache-control': 'no-store',
            'content-length': '0',
          })
          response.end()
        } catch {
          sendJson(response, 409, { error: 'restart-unavailable' })
        }
      },
    }),
  ]
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
