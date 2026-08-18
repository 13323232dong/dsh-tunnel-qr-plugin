import type { TunnelQrResponse, TunnelStatusResponse } from './contracts.js';
export interface TunnelClientApi {
    readStatus(signal?: AbortSignal): Promise<TunnelStatusResponse>;
    readFreshQr(signal?: AbortSignal): Promise<TunnelQrResponse>;
    restart(signal?: AbortSignal): Promise<void>;
}
interface FetchLike {
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
export declare function createTunnelClientApi(fetcher?: FetchLike): TunnelClientApi;
export {};
//# sourceMappingURL=api.d.ts.map