function sendJson(response, status, value, headers = {}) {
    const body = JSON.stringify(value);
    response.writeHead(status, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
        ...headers,
    });
    response.end(body);
}
function methodNotAllowed(response, allow) {
    response.writeHead(405, {
        allow,
        'cache-control': 'no-store',
        'content-length': '0',
    });
    response.end();
}
/**
 * Register the plugin-owned tunnel status and QR action routes.
 * @param webServer - host web server service.
 * @param handlers - status and action callbacks owned by the service.
 * @returns disposer removing every exact route.
 */
export function registerTunnelRoutes(webServer, handlers) {
    const disposers = [
        webServer.register({
            kind: 'exact',
            path: '/dsh-tunnel/status',
            handler: async (request, response) => {
                if (request.method !== 'GET' && request.method !== 'HEAD') {
                    methodNotAllowed(response, 'GET, HEAD');
                    return;
                }
                const body = JSON.stringify({ snapshot: handlers.getSnapshot() });
                response.writeHead(200, {
                    'cache-control': 'no-store',
                    'content-type': 'application/json; charset=utf-8',
                    'content-length': String(Buffer.byteLength(body)),
                });
                response.end(request.method === 'HEAD' ? undefined : body);
            },
        }),
        webServer.register({
            kind: 'exact',
            path: '/dsh-tunnel/qr',
            handler: async (request, response) => {
                if (request.method !== 'POST') {
                    methodNotAllowed(response, 'POST');
                    return;
                }
                try {
                    sendJson(response, 200, await handlers.createQr());
                }
                catch {
                    sendJson(response, 409, { error: 'tunnel-not-ready' });
                }
            },
        }),
        webServer.register({
            kind: 'exact',
            path: '/dsh-tunnel/restart',
            handler: async (request, response) => {
                if (request.method !== 'POST') {
                    methodNotAllowed(response, 'POST');
                    return;
                }
                try {
                    await handlers.restart();
                    response.writeHead(204, {
                        'cache-control': 'no-store',
                        'content-length': '0',
                    });
                    response.end();
                }
                catch {
                    sendJson(response, 409, { error: 'restart-unavailable' });
                }
            },
        }),
    ];
    return () => {
        for (const dispose of disposers.reverse())
            dispose();
    };
}
//# sourceMappingURL=routes.js.map