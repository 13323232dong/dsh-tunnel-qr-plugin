/** Runtime settings for download, authentication, and tunnel recovery. */
export interface TunnelConfig {
    readonly cloudflaredVersion: string;
    readonly downloadTimeoutMs: number;
    readonly tunnelStartupTimeoutMs: number;
    readonly qrTokenLifetimeMs: number;
    readonly publicSessionLifetimeMs: number;
    readonly restartLimit: number;
    readonly restartBackoffMinMs: number;
    readonly restartBackoffMaxMs: number;
    readonly binaryCacheDirectory: string | undefined;
}
/** Defaults used by the credential-free bundle patch. */
export declare const DEFAULT_TUNNEL_CONFIG: TunnelConfig;
/** Resolve partial plugin input into one validated immutable configuration. */
export declare function resolveTunnelConfig(input?: Partial<TunnelConfig>): TunnelConfig;
//# sourceMappingURL=config.d.ts.map