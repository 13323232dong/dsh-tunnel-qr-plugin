import type { CloudflaredArtifact } from './artifacts.js';
export interface EnsureCloudflaredOptions {
    readonly version: string;
    readonly artifact: CloudflaredArtifact;
    readonly expectedSha256: string;
    readonly cacheDirectory: string;
    readonly downloadUrl?: string;
    readonly downloadTimeoutMs?: number;
    /** Allows a loopback HTTP fixture; production callers must leave this false. */
    readonly allowHttpForTests?: boolean;
}
type DownloadErrorCode = 'checksum-mismatch' | 'download-failed' | 'invalid-archive';
export declare class CloudflaredDownloadError extends Error {
    readonly code: DownloadErrorCode;
    constructor(code: DownloadErrorCode, message: string, options?: ErrorOptions);
}
/** Download, verify, and cache one exact official cloudflared executable. */
export declare function ensureCloudflared(options: EnsureCloudflaredOptions): Promise<string>;
export {};
//# sourceMappingURL=download.d.ts.map