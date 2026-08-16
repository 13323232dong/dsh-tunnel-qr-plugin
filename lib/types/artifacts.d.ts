/** Packaging used by one official Cloudflare release asset. */
export type ArtifactArchive = 'raw' | 'tar-gzip';
/** Exact executable source for one supported Node platform pair. */
export interface CloudflaredArtifact {
    readonly asset: string;
    readonly sha256: string;
    readonly executable: string;
    readonly archive: ArtifactArchive;
    readonly requiresX64Emulation: boolean;
}
export type ArtifactResolution = {
    readonly ok: true;
    readonly artifact: CloudflaredArtifact;
} | {
    readonly ok: false;
    readonly code: 'unsupported-platform';
    readonly platform: string;
    readonly architecture: string;
};
/** Resolve only explicitly supported pairs; unknown pairs fail closed. */
export declare function resolveArtifact(platform: string, architecture: string): ArtifactResolution;
//# sourceMappingURL=artifacts.d.ts.map