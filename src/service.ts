import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveArtifact } from './artifacts.js'
import type { TunnelConfig } from './config.js'
import { DEFAULT_TUNNEL_CONFIG } from './config.js'
import type { TunnelQrResponse, TunnelSnapshot } from './contracts.js'
import { QrCredentials } from './credentials.js'
import { ensureCloudflared, CloudflaredDownloadError } from './download.js'
import { AuthenticationProxy } from './proxy.js'
import { FixedWindowRateLimiter } from './rate-limit.js'
import { registerTunnelRoutes } from './routes.js'
import { TunnelManager } from './tunnel-manager.js'

export type PluginConfig = Partial<TunnelConfig>
type UnsupportedSnapshot = Extract<TunnelSnapshot, { status: 'unsupported' }>
type FailedSnapshot = Extract<TunnelSnapshot, { status: 'failed' }>
type StartingSnapshot = Extract<TunnelSnapshot, { status: 'starting' }>

const require = createRequire(import.meta.url)
const QRCodeServer = require('qrcode/lib/server.js') as {
  toDataURL(
    text: string,
    options: {
      readonly errorCorrectionLevel: 'M'
      readonly margin: 2
      readonly width: 320
    },
  ): Promise<string>
}

export const Config: z<PluginConfig> = z.object({
  cloudflaredVersion: z.string().default(DEFAULT_TUNNEL_CONFIG.cloudflaredVersion),
  downloadTimeoutMs: z.natural().min(1).default(DEFAULT_TUNNEL_CONFIG.downloadTimeoutMs),
  tunnelStartupTimeoutMs: z.natural().min(1).default(DEFAULT_TUNNEL_CONFIG.tunnelStartupTimeoutMs),
  qrTokenLifetimeMs: z.natural().min(1).default(DEFAULT_TUNNEL_CONFIG.qrTokenLifetimeMs),
  publicSessionLifetimeMs: z.natural().min(1).default(DEFAULT_TUNNEL_CONFIG.publicSessionLifetimeMs),
  restartLimit: z.natural().default(DEFAULT_TUNNEL_CONFIG.restartLimit),
  restartBackoffMinMs: z.natural().min(1).default(DEFAULT_TUNNEL_CONFIG.restartBackoffMinMs),
  restartBackoffMaxMs: z.natural().min(1).default(DEFAULT_TUNNEL_CONFIG.restartBackoffMaxMs),
  binaryCacheDirectory: z.union([z.string(), z.const(undefined)]).default(undefined),
})

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function defaultCacheDirectory(config: PluginConfig): string {
  return config.binaryCacheDirectory ?? join(dshHome(), 'plugins', 'dsh-tunnel-qr-plugin', 'cloudflared')
}

function snapshotNow<T extends TunnelSnapshot>(snapshot: Omit<T, 'updatedAt'>): T {
  return Object.freeze({ ...snapshot, updatedAt: Date.now() }) as T
}

/**
 * Create one fresh QR response for the currently ready public URL.
 * @param publicUrl - current public base URL.
 * @param generation - active tunnel generation.
 * @param credentials - single-use credential owner.
 * @returns QR payload with a fragment-only login token.
 */
export async function createQrResponse(
  publicUrl: string,
  generation: number,
  credentials: QrCredentials,
): Promise<TunnelQrResponse> {
  const issued = credentials.issueQrToken(generation)
  const loginUrl = new URL('/dsh-qr-login', publicUrl)
  loginUrl.hash = issued.token
  const qrDataUrl = await QRCodeServer.toDataURL(loginUrl.href, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  })
  return {
    generation,
    publicUrl,
    expiresAt: issued.expiresAt,
    loginUrl: loginUrl.href,
    qrDataUrl,
  }
}

/** Host service that owns tunnel startup, authenticated proxying, and QR routes. */
export class TunnelQrService extends Service {
  static inject = ['webServer']
  static Config = Config

  private snapshot: TunnelSnapshot = snapshotNow<StartingSnapshot>({ status: 'starting', generation: 0 })
  private credentials!: QrCredentials
  private proxy: AuthenticationProxy | undefined
  private manager: TunnelManager | undefined

  constructor(ctx: ConstructorParameters<typeof Service>[0], private readonly config: PluginConfig = {}) {
    super(ctx, 'tunnelQr')
  }

  getSnapshot(): TunnelSnapshot {
    return this.manager?.getSnapshot() ?? this.snapshot
  }

  async createQr(): Promise<TunnelQrResponse> {
    const snapshot = this.getSnapshot()
    if (snapshot.status !== 'ready') throw new Error('tunnel is not ready')
    return createQrResponse(snapshot.publicUrl, snapshot.generation, this.credentials)
  }

  async restart(): Promise<void> {
    if (this.manager === undefined) throw new Error('restart unavailable')
    await this.manager.restart()
  }

  async [Service.init](): Promise<void> {
    this.credentials = new QrCredentials({
      tokenLifetimeMs: this.config.qrTokenLifetimeMs ?? DEFAULT_TUNNEL_CONFIG.qrTokenLifetimeMs,
      sessionLifetimeMs: this.config.publicSessionLifetimeMs ?? DEFAULT_TUNNEL_CONFIG.publicSessionLifetimeMs,
    })
    this.ctx.effect(
      () => registerTunnelRoutes(this.ctx.webServer, {
        getSnapshot: () => this.getSnapshot(),
        createQr: () => this.createQr(),
        restart: () => this.restart(),
      }),
      'tunnel-qr: routes',
    )
    this.ctx.effect(() => () => void this.disposeOwned(), 'tunnel-qr: resources')
    await this.initializeRuntime()
  }

  private async initializeRuntime(): Promise<void> {
    const artifactResolution = resolveArtifact(process.platform, process.arch)
    if (!artifactResolution.ok) {
      this.snapshot = snapshotNow<UnsupportedSnapshot>({
        status: 'unsupported',
        generation: 0,
        code: 'unsupported-platform',
        message: '当前平台暂不支持自动公网隧道。',
      })
      return
    }

    let executable: string
    try {
      executable = await ensureCloudflared({
        version: this.config.cloudflaredVersion ?? DEFAULT_TUNNEL_CONFIG.cloudflaredVersion,
        artifact: artifactResolution.artifact,
        expectedSha256: artifactResolution.artifact.sha256,
        cacheDirectory: defaultCacheDirectory(this.config),
        downloadTimeoutMs: this.config.downloadTimeoutMs ?? DEFAULT_TUNNEL_CONFIG.downloadTimeoutMs,
      })
    } catch (error) {
      if (error instanceof CloudflaredDownloadError) {
        const code: FailedSnapshot['code'] = error.code === 'checksum-mismatch' ? 'checksum-mismatch' : 'download-failed'
        this.snapshot = snapshotNow<FailedSnapshot>({
          status: 'failed',
          generation: 0,
          code,
          message: '公网隧道依赖下载失败。',
          retryable: true,
        })
        return
      }
      this.snapshot = snapshotNow<FailedSnapshot>({
        status: 'failed',
        generation: 0,
        code: 'download-failed',
        message: '公网隧道依赖下载失败。',
        retryable: true,
      })
      return
    }

    const limiter = new FixedWindowRateLimiter({
      perSourceLimit: 10,
      globalLimit: 100,
      windowMs: 60_000,
      maxSources: 1_000,
    })
    this.proxy = new AuthenticationProxy({
      targetHost: '127.0.0.1',
      targetPort: this.ctx.webServer.port,
      credentials: this.credentials,
      generation: () => this.manager?.getSnapshot().generation ?? 0,
      limiter,
      sessionLifetimeMs: this.config.publicSessionLifetimeMs ?? DEFAULT_TUNNEL_CONFIG.publicSessionLifetimeMs,
    })
    let proxyPort: number
    try {
      proxyPort = await this.proxy.start()
    } catch {
      this.snapshot = snapshotNow<FailedSnapshot>({
        status: 'failed',
        generation: 0,
        code: 'proxy-bind-failed',
        message: '公网隧道入口启动失败。',
        retryable: true,
      })
      return
    }

    this.manager = new TunnelManager({
      executable,
      proxyPort,
      startupTimeoutMs: this.config.tunnelStartupTimeoutMs ?? DEFAULT_TUNNEL_CONFIG.tunnelStartupTimeoutMs,
      restartLimit: this.config.restartLimit ?? DEFAULT_TUNNEL_CONFIG.restartLimit,
      restartBackoffMinMs: this.config.restartBackoffMinMs ?? DEFAULT_TUNNEL_CONFIG.restartBackoffMinMs,
      restartBackoffMaxMs: this.config.restartBackoffMaxMs ?? DEFAULT_TUNNEL_CONFIG.restartBackoffMaxMs,
      onGenerationRetired: generation => { this.credentials.invalidateGeneration(generation) },
    })
    void this.manager.start()
  }

  private async disposeOwned(): Promise<void> {
    await this.manager?.dispose()
    this.manager = undefined
    await this.proxy?.close()
    this.proxy = undefined
    this.credentials.clear()
  }
}

export default TunnelQrService
