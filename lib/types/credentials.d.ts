interface CredentialOptions {
    readonly tokenLifetimeMs: number;
    readonly sessionLifetimeMs: number;
    readonly now?: () => number;
}
export interface IssuedQrToken {
    readonly token: string;
    readonly expiresAt: number;
}
export type TokenExchange = {
    readonly ok: true;
    readonly session: string;
    readonly expiresAt: number;
} | {
    readonly ok: false;
    readonly code: 'invalid-token';
};
/** In-memory owner for single-use QR tokens and public browser sessions. */
export declare class QrCredentials {
    private readonly tokenLifetimeMs;
    private readonly sessionLifetimeMs;
    private readonly now;
    private readonly tokens;
    private readonly sessions;
    constructor(options: CredentialOptions);
    /** Mint one opaque token tied to the current public tunnel generation. */
    issueQrToken(generation: number): IssuedQrToken;
    /** Consume a QR token exactly once and create a public-session cookie value. */
    exchangeQrToken(token: string, generation: number): TokenExchange;
    /** Validate one public-session cookie for the active tunnel generation. */
    validateSession(session: string, generation: number): boolean;
    /** Remove every token and session associated with a retired public URL. */
    invalidateGeneration(generation: number): void;
    /** Remove expired records without exposing stored digests. */
    prune(): void;
    /** Drop all authentication state during plugin shutdown. */
    clear(): void;
    /** Diagnostic counts that never reveal credential material. */
    counts(): {
        readonly tokens: number;
        readonly sessions: number;
    };
}
export {};
//# sourceMappingURL=credentials.d.ts.map