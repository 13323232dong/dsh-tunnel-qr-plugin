interface RateLimiterOptions {
    readonly perSourceLimit: number;
    readonly globalLimit: number;
    readonly windowMs: number;
    readonly maxSources: number;
    readonly now?: () => number;
}
/** Bounded fixed-window limiter for the public QR exchange endpoint. */
export declare class FixedWindowRateLimiter {
    private readonly options;
    private readonly now;
    private readonly sources;
    private global;
    constructor(options: RateLimiterOptions);
    /** Consume one attempt when both the source and global windows permit it. */
    allow(source: string): boolean;
    /** Number of source windows retained for bounded-memory diagnostics. */
    sourceCount(): number;
    private currentWindow;
    private pruneExpired;
}
export {};
//# sourceMappingURL=rate-limit.d.ts.map