export interface TunnelProcessExit {
    readonly code: number | null;
    readonly signal: string | null;
}
export interface TunnelProcess {
    readonly exited: Promise<TunnelProcessExit>;
    onLine(listener: (line: string) => void): () => void;
    diagnostics(): readonly string[];
    stop(): Promise<void>;
}
export interface SpawnTunnelOptions {
    readonly executable: string;
    readonly proxyPort: number;
}
/** Extract the canonical origin from a Cloudflare Quick Tunnel log line. */
export declare function parseQuickTunnelUrl(line: string): string | undefined;
/** Spawn the official cloudflared process with updates disabled and a loopback proxy target. */
export declare function spawnTunnelProcess(options: SpawnTunnelOptions): TunnelProcess;
//# sourceMappingURL=tunnel-process.d.ts.map