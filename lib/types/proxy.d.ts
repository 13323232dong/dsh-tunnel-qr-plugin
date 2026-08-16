import type { QrCredentials } from './credentials.js';
import type { FixedWindowRateLimiter } from './rate-limit.js';
export interface AuthenticationProxyOptions {
    readonly targetHost: string;
    readonly targetPort: number;
    readonly credentials: QrCredentials;
    readonly generation: () => number;
    readonly limiter: FixedWindowRateLimiter;
    readonly sessionLifetimeMs: number;
}
/** Loopback-only authentication and reverse proxy in front of the DSH Web server. */
export declare class AuthenticationProxy {
    private readonly options;
    private server;
    private readonly sockets;
    constructor(options: AuthenticationProxyOptions);
    /** Bind the proxy and return its OS-assigned loopback port. */
    start(): Promise<number>;
    private isAuthenticated;
    private handle;
    private forwardHttp;
    private handleUpgrade;
    /** Stop accepting traffic and destroy every owned HTTP or upgraded socket. */
    close(): Promise<void>;
}
//# sourceMappingURL=proxy.d.ts.map