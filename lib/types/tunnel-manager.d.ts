import type { TunnelSnapshot } from './contracts.js';
import type { TunnelProcess } from './tunnel-process.js';
interface TunnelManagerOptions {
    readonly executable: string;
    readonly proxyPort: number;
    readonly startupTimeoutMs: number;
    readonly restartLimit: number;
    readonly restartBackoffMinMs: number;
    readonly restartBackoffMaxMs: number;
    readonly spawn?: (options: {
        readonly executable: string;
        readonly proxyPort: number;
    }) => TunnelProcess;
    readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    readonly now?: () => number;
    readonly onGenerationRetired?: (generation: number) => void;
}
/** Owns one Quick Tunnel process at a time and publishes immutable recovery state. */
export declare class TunnelManager {
    private readonly options;
    private readonly spawn;
    private readonly sleep;
    private readonly now;
    private readonly listeners;
    private snapshot;
    private runId;
    private generation;
    private current;
    private loop;
    private abortController;
    private started;
    private disposed;
    constructor(options: TunnelManagerOptions);
    getSnapshot(): TunnelSnapshot;
    subscribe(listener: () => void): () => void;
    /** Start recovery and resolve after the first ready or terminal state. */
    start(): Promise<void>;
    /** Stop the current process and begin a fresh generation immediately. */
    restart(): Promise<void>;
    private beginRun;
    private runLoop;
    private waitForOutcome;
    private retry;
    private publish;
    /** Cancel recovery and terminate the exact owned process tree. */
    dispose(): Promise<void>;
}
export {};
//# sourceMappingURL=tunnel-manager.d.ts.map