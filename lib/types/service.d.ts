import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { TunnelConfig } from './config.js';
import type { TunnelQrResponse, TunnelSnapshot } from './contracts.js';
import { QrCredentials } from './credentials.js';
export type PluginConfig = Partial<TunnelConfig>;
export declare const Config: z<PluginConfig>;
/**
 * Create one fresh QR response for the currently ready public URL.
 * @param publicUrl - current public base URL.
 * @param generation - active tunnel generation.
 * @param credentials - single-use credential owner.
 * @returns QR payload with a fragment-only login token.
 */
export declare function createQrResponse(publicUrl: string, generation: number, credentials: QrCredentials): Promise<TunnelQrResponse>;
/** Host service that owns tunnel startup, authenticated proxying, and QR routes. */
export declare class TunnelQrService extends Service {
    static inject: string[];
    static Config: z<Partial<TunnelConfig>>;
    private snapshot;
    private credentials;
    private proxy;
    private manager;
    constructor(ctx: ConstructorParameters<typeof Service>[0], config?: PluginConfig);
    private readonly config;
    getSnapshot(): TunnelSnapshot;
    createQr(): Promise<TunnelQrResponse>;
    restart(): Promise<void>;
    [Service.init](): Promise<void>;
    private initializeRuntime;
    private disposeOwned;
}
export default TunnelQrService;
//# sourceMappingURL=service.d.ts.map