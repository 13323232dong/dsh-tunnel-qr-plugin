import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const EMPTY_DIGEST = Buffer.alloc(32)

interface CredentialOptions {
  readonly tokenLifetimeMs: number
  readonly sessionLifetimeMs: number
  readonly now?: () => number
}

interface CredentialRecord {
  readonly digest: Buffer
  readonly generation: number
  readonly expiresAt: number
}

interface SessionRecord {
  readonly digest: Buffer
  readonly expiresAt: number
}

export interface IssuedQrToken {
  readonly token: string
  readonly expiresAt: number
}

export type TokenExchange =
  | { readonly ok: true; readonly session: string; readonly expiresAt: number }
  | { readonly ok: false; readonly code: 'invalid-token' }

function requirePositive(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`)
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** In-memory owner for single-use QR tokens and public browser sessions. */
export class QrCredentials {
  private readonly tokenLifetimeMs: number
  private readonly sessionLifetimeMs: number
  private readonly now: () => number
  private readonly tokens = new Map<string, CredentialRecord>()
  private readonly sessions = new Map<string, SessionRecord>()

  constructor(options: CredentialOptions) {
    requirePositive('tokenLifetimeMs', options.tokenLifetimeMs)
    requirePositive('sessionLifetimeMs', options.sessionLifetimeMs)
    this.tokenLifetimeMs = options.tokenLifetimeMs
    this.sessionLifetimeMs = options.sessionLifetimeMs
    this.now = options.now ?? Date.now
  }

  /** Mint one opaque token tied to the current public tunnel generation. */
  issueQrToken(generation: number): IssuedQrToken {
    this.prune()
    const token = randomBytes(32).toString('base64url')
    const tokenDigest = digest(token)
    const expiresAt = this.now() + this.tokenLifetimeMs
    this.tokens.set(tokenDigest.toString('hex'), { digest: tokenDigest, generation, expiresAt })
    return { token, expiresAt }
  }

  /** Consume a QR token exactly once and create a public-session cookie value. */
  exchangeQrToken(token: string, generation: number): TokenExchange {
    const presentedDigest = digest(token)
    const key = presentedDigest.toString('hex')
    const record = this.tokens.get(key)
    this.tokens.delete(key)
    const digestMatches = timingSafeEqual(record?.digest ?? EMPTY_DIGEST, presentedDigest)
    if (record === undefined
      || !digestMatches
      || record.generation !== generation
      || record.expiresAt <= this.now()) return { ok: false, code: 'invalid-token' }

    const session = randomBytes(32).toString('base64url')
    const sessionDigest = digest(session)
    const expiresAt = this.now() + this.sessionLifetimeMs
    this.sessions.set(sessionDigest.toString('hex'), { digest: sessionDigest, expiresAt })
    return { ok: true, session, expiresAt }
  }

  /**
   * Validate one public-session cookie.
   * Sessions are browser-host scoped by the tunnel hostname, so a reconnect
   * generation must not invalidate an already opened public page.
   */
  validateSession(session: string, _generation: number): boolean {
    const presentedDigest = digest(session)
    const key = presentedDigest.toString('hex')
    const record = this.sessions.get(key)
    const digestMatches = timingSafeEqual(record?.digest ?? EMPTY_DIGEST, presentedDigest)
    if (record === undefined) return false
    const valid = digestMatches
      && record.expiresAt > this.now()
    if (!valid) this.sessions.delete(key)
    return valid
  }

  /** Remove QR tokens associated with a retired public URL. */
  invalidateGeneration(generation: number): void {
    for (const [key, record] of this.tokens) {
      if (record.generation === generation) this.tokens.delete(key)
    }
  }

  /** Remove expired records without exposing stored digests. */
  prune(): void {
    const now = this.now()
    for (const [key, record] of this.tokens) {
      if (record.expiresAt <= now) this.tokens.delete(key)
    }
    for (const [key, record] of this.sessions) {
      if (record.expiresAt <= now) this.sessions.delete(key)
    }
  }

  /** Drop all authentication state during plugin shutdown. */
  clear(): void {
    this.tokens.clear()
    this.sessions.clear()
  }

  /** Diagnostic counts that never reveal credential material. */
  counts(): { readonly tokens: number; readonly sessions: number } {
    this.prune()
    return { tokens: this.tokens.size, sessions: this.sessions.size }
  }
}
