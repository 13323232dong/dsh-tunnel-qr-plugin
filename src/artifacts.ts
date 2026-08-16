/** Packaging used by one official Cloudflare release asset. */
export type ArtifactArchive = 'raw' | 'tar-gzip'

/** Exact executable source for one supported Node platform pair. */
export interface CloudflaredArtifact {
  readonly asset: string
  readonly executable: string
  readonly archive: ArtifactArchive
  readonly requiresX64Emulation: boolean
}

export type ArtifactResolution =
  | { readonly ok: true; readonly artifact: CloudflaredArtifact }
  | {
    readonly ok: false
    readonly code: 'unsupported-platform'
    readonly platform: string
    readonly architecture: string
  }

const ARTIFACTS: Readonly<Record<string, CloudflaredArtifact>> = Object.freeze({
  'darwin/x64': Object.freeze({
    asset: 'cloudflared-darwin-amd64.tgz',
    executable: 'cloudflared',
    archive: 'tar-gzip',
    requiresX64Emulation: false,
  }),
  'darwin/arm64': Object.freeze({
    asset: 'cloudflared-darwin-arm64.tgz',
    executable: 'cloudflared',
    archive: 'tar-gzip',
    requiresX64Emulation: false,
  }),
  'linux/x64': Object.freeze({
    asset: 'cloudflared-linux-amd64',
    executable: 'cloudflared',
    archive: 'raw',
    requiresX64Emulation: false,
  }),
  'linux/arm64': Object.freeze({
    asset: 'cloudflared-linux-arm64',
    executable: 'cloudflared',
    archive: 'raw',
    requiresX64Emulation: false,
  }),
  'win32/x64': Object.freeze({
    asset: 'cloudflared-windows-amd64.exe',
    executable: 'cloudflared.exe',
    archive: 'raw',
    requiresX64Emulation: false,
  }),
  'win32/arm64': Object.freeze({
    asset: 'cloudflared-windows-amd64.exe',
    executable: 'cloudflared.exe',
    archive: 'raw',
    requiresX64Emulation: true,
  }),
})

/** Resolve only explicitly supported pairs; unknown pairs fail closed. */
export function resolveArtifact(platform: string, architecture: string): ArtifactResolution {
  const artifact = ARTIFACTS[`${platform}/${architecture}`]
  return artifact === undefined
    ? { ok: false, code: 'unsupported-platform', platform, architecture }
    : { ok: true, artifact }
}
