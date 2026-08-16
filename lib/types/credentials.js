import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
const EMPTY_DIGEST = Buffer.alloc(32);
function requirePositive(name, value) {
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new RangeError(`${name} must be a positive integer`);
}
function digest(value) {
    return createHash('sha256').update(value, 'utf8').digest();
}
/** In-memory owner for single-use QR tokens and public browser sessions. */
export class QrCredentials {
    tokenLifetimeMs;
    sessionLifetimeMs;
    now;
    tokens = new Map();
    sessions = new Map();
    constructor(options) {
        requirePositive('tokenLifetimeMs', options.tokenLifetimeMs);
        requirePositive('sessionLifetimeMs', options.sessionLifetimeMs);
        this.tokenLifetimeMs = options.tokenLifetimeMs;
        this.sessionLifetimeMs = options.sessionLifetimeMs;
        this.now = options.now ?? Date.now;
    }
    /** Mint one opaque token tied to the current public tunnel generation. */
    issueQrToken(generation) {
        this.prune();
        const token = randomBytes(32).toString('base64url');
        const tokenDigest = digest(token);
        const expiresAt = this.now() + this.tokenLifetimeMs;
        this.tokens.set(tokenDigest.toString('hex'), { digest: tokenDigest, generation, expiresAt });
        return { token, expiresAt };
    }
    /** Consume a QR token exactly once and create a public-session cookie value. */
    exchangeQrToken(token, generation) {
        const presentedDigest = digest(token);
        const key = presentedDigest.toString('hex');
        const record = this.tokens.get(key);
        this.tokens.delete(key);
        const digestMatches = timingSafeEqual(record?.digest ?? EMPTY_DIGEST, presentedDigest);
        if (record === undefined
            || !digestMatches
            || record.generation !== generation
            || record.expiresAt <= this.now())
            return { ok: false, code: 'invalid-token' };
        const session = randomBytes(32).toString('base64url');
        const sessionDigest = digest(session);
        const expiresAt = this.now() + this.sessionLifetimeMs;
        this.sessions.set(sessionDigest.toString('hex'), {
            digest: sessionDigest,
            generation,
            expiresAt,
        });
        return { ok: true, session, expiresAt };
    }
    /** Validate one public-session cookie for the active tunnel generation. */
    validateSession(session, generation) {
        const presentedDigest = digest(session);
        const key = presentedDigest.toString('hex');
        const record = this.sessions.get(key);
        const digestMatches = timingSafeEqual(record?.digest ?? EMPTY_DIGEST, presentedDigest);
        if (record === undefined)
            return false;
        const valid = digestMatches
            && record.generation === generation
            && record.expiresAt > this.now();
        if (!valid)
            this.sessions.delete(key);
        return valid;
    }
    /** Remove every token and session associated with a retired public URL. */
    invalidateGeneration(generation) {
        for (const [key, record] of this.tokens) {
            if (record.generation === generation)
                this.tokens.delete(key);
        }
        for (const [key, record] of this.sessions) {
            if (record.generation === generation)
                this.sessions.delete(key);
        }
    }
    /** Remove expired records without exposing stored digests. */
    prune() {
        const now = this.now();
        for (const [key, record] of this.tokens) {
            if (record.expiresAt <= now)
                this.tokens.delete(key);
        }
        for (const [key, record] of this.sessions) {
            if (record.expiresAt <= now)
                this.sessions.delete(key);
        }
    }
    /** Drop all authentication state during plugin shutdown. */
    clear() {
        this.tokens.clear();
        this.sessions.clear();
    }
    /** Diagnostic counts that never reveal credential material. */
    counts() {
        this.prune();
        return { tokens: this.tokens.size, sessions: this.sessions.size };
    }
}
//# sourceMappingURL=credentials.js.map