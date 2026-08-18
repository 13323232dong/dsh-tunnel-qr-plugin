import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  chmod, lstat, mkdir, readFile, rename, rm, writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as tar from 'tar'
import type { CloudflaredArtifact } from './artifacts.js'

const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024
const inFlight = new Map<string, Promise<string>>()

interface CacheMetadata {
  readonly version: string
  readonly asset: string
  readonly archiveSha256: string
  readonly executableSha256: string
}

export interface EnsureCloudflaredOptions {
  readonly version: string
  readonly artifact: CloudflaredArtifact
  readonly expectedSha256: string
  readonly cacheDirectory: string
  readonly downloadUrl?: string
  readonly downloadTimeoutMs?: number
  /** Allows a loopback HTTP fixture; production callers must leave this false. */
  readonly allowHttpForTests?: boolean
}

type DownloadErrorCode = 'checksum-mismatch' | 'download-failed' | 'invalid-archive'

export class CloudflaredDownloadError extends Error {
  constructor(readonly code: DownloadErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CloudflaredDownloadError'
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function cachePaths(options: EnsureCloudflaredOptions): {
  readonly directory: string
  readonly executable: string
  readonly metadata: string
} {
  const directory = join(options.cacheDirectory, options.version, options.artifact.asset)
  return {
    directory,
    executable: join(directory, options.artifact.executable),
    metadata: join(directory, 'verified.json'),
  }
}

async function validatedCachedExecutable(
  options: EnsureCloudflaredOptions,
  executable: string,
  metadataPath: string,
): Promise<string | undefined> {
  try {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Partial<CacheMetadata>
    if (metadata.version !== options.version
      || metadata.asset !== options.artifact.asset
      || metadata.archiveSha256 !== options.expectedSha256
      || typeof metadata.executableSha256 !== 'string') return undefined
    const file = await lstat(executable)
    if (!file.isFile() || file.isSymbolicLink()) return undefined
    return await sha256File(executable) === metadata.executableSha256 ? executable : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined
    throw error
  }
}

async function downloadAsset(options: EnsureCloudflaredOptions, destination: string): Promise<void> {
  const url = new URL(options.downloadUrl
    ?? `https://github.com/cloudflare/cloudflared/releases/download/${options.version}/${options.artifact.asset}`)
  const isAllowedFixture = options.allowHttpForTests === true
    && url.protocol === 'http:'
    && (url.hostname === '127.0.0.1' || url.hostname === '::1')
  if (url.protocol !== 'https:' && !isAllowedFixture) {
    throw new CloudflaredDownloadError('download-failed', 'cloudflared download URL must use HTTPS')
  }

  const signal = AbortSignal.timeout(options.downloadTimeoutMs ?? 30_000)
  let response: Response
  try {
    response = await fetch(url, { signal, redirect: 'follow' })
  } catch (error) {
    throw new CloudflaredDownloadError('download-failed', 'cloudflared download failed', { cause: error })
  }
  const finalUrl = new URL(response.url)
  const finalFixture = options.allowHttpForTests === true
    && finalUrl.protocol === 'http:'
    && (finalUrl.hostname === '127.0.0.1' || finalUrl.hostname === '::1')
  if ((finalUrl.protocol !== 'https:' && !finalFixture) || !response.ok || response.body === null) {
    throw new CloudflaredDownloadError('download-failed', 'cloudflared download returned an invalid response')
  }
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
    throw new CloudflaredDownloadError('download-failed', 'cloudflared download exceeded the size limit')
  }

  let bytes = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength
      callback(bytes > MAX_DOWNLOAD_BYTES
        ? new CloudflaredDownloadError('download-failed', 'cloudflared download exceeded the size limit')
        : undefined, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(destination, { flags: 'wx' }))
  } catch (error) {
    throw error instanceof CloudflaredDownloadError
      ? error
      : new CloudflaredDownloadError('download-failed', 'cloudflared download was interrupted', { cause: error })
  }
}

async function materializeExecutable(
  archivePath: string,
  temporaryDirectory: string,
  artifact: CloudflaredArtifact,
): Promise<string> {
  if (artifact.archive === 'raw') return archivePath
  const extractionRoot = join(temporaryDirectory, 'extracted')
  await mkdir(extractionRoot)
  try {
    await tar.x({
      cwd: extractionRoot,
      file: archivePath,
      gzip: true,
      preservePaths: false,
      strict: true,
      filter: path => path === artifact.executable || path === `./${artifact.executable}`,
    })
  } catch (error) {
    throw new CloudflaredDownloadError('invalid-archive', 'cloudflared archive extraction failed', { cause: error })
  }
  const extracted = join(extractionRoot, artifact.executable)
  try {
    const file = await lstat(extracted)
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('expected a regular executable file')
  } catch (error) {
    throw new CloudflaredDownloadError('invalid-archive', 'cloudflared archive did not contain the expected executable', { cause: error })
  }
  return extracted
}

async function ensureOnce(options: EnsureCloudflaredOptions): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(options.expectedSha256)) {
    throw new CloudflaredDownloadError('checksum-mismatch', 'cloudflared checksum must be a lowercase SHA-256 digest')
  }
  const paths = cachePaths(options)
  const cached = await validatedCachedExecutable(options, paths.executable, paths.metadata)
  if (cached !== undefined) return cached
  await mkdir(paths.directory, { recursive: true })

  const temporaryDirectory = join(paths.directory, `.download-${randomUUID()}`)
  const archivePath = join(temporaryDirectory, 'asset')
  await mkdir(temporaryDirectory)
  try {
    await downloadAsset(options, archivePath)
    const downloadedSha256 = await sha256File(archivePath)
    if (downloadedSha256 !== options.expectedSha256) {
      throw new CloudflaredDownloadError('checksum-mismatch', 'cloudflared checksum did not match the pinned release')
    }
    const materialized = await materializeExecutable(archivePath, temporaryDirectory, options.artifact)
    const staged = join(temporaryDirectory, options.artifact.executable)
    if (materialized !== staged) await writeFile(staged, await readFile(materialized), { flag: 'wx' })
    if (process.platform !== 'win32') await chmod(staged, 0o700)
    const executableSha256 = await sha256File(staged)

    const backup = join(temporaryDirectory, 'previous-executable')
    let movedExisting = false
    try {
      await rename(paths.executable, backup)
      movedExisting = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      await rename(staged, paths.executable)
    } catch (error) {
      if (movedExisting) await rename(backup, paths.executable)
      throw error
    }
    const metadata: CacheMetadata = {
      version: options.version,
      asset: options.artifact.asset,
      archiveSha256: options.expectedSha256,
      executableSha256,
    }
    const temporaryMetadata = join(temporaryDirectory, 'verified.json')
    await writeFile(temporaryMetadata, `${JSON.stringify(metadata)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(temporaryMetadata, paths.metadata)
    return paths.executable
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

/** Download, verify, and cache one exact official cloudflared executable. */
export function ensureCloudflared(options: EnsureCloudflaredOptions): Promise<string> {
  const paths = cachePaths(options)
  const key = paths.executable
  const existing = inFlight.get(key)
  if (existing !== undefined) return existing
  const operation = ensureOnce(options).finally(() => { inFlight.delete(key) })
  inFlight.set(key, operation)
  return operation
}
