import type { WebServer } from '@deepseek-ai/dsh-host-webserver';
import type { TunnelQrResponse, TunnelSnapshot } from './contracts.js';
interface TunnelRouteHandlers {
    readonly getSnapshot: () => TunnelSnapshot;
    readonly createQr: () => Promise<TunnelQrResponse>;
    readonly restart: () => Promise<void>;
}
/**
 * Register the plugin-owned tunnel status and QR action routes.
 * @param webServer - host web server service.
 * @param handlers - status and action callbacks owned by the service.
 * @returns disposer removing every exact route.
 */
export declare function registerTunnelRoutes(webServer: WebServer, handlers: TunnelRouteHandlers): () => void;
export {};
//# sourceMappingURL=routes.d.ts.map