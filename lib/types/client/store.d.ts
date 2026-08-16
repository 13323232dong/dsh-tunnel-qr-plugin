import type { TunnelQrResponse, TunnelSnapshot } from './contracts.js';
import type { TunnelClientApi } from './api.js';
export type CopyState = 'idle' | 'copied' | 'failed';
export type BusyState = 'idle' | 'refreshing' | 'restarting';
export interface TunnelQrOverlayState {
    readonly open: boolean;
    readonly busy: BusyState;
    readonly status: TunnelSnapshot | null;
    readonly qr: TunnelQrResponse | null;
    readonly error: string | null;
    readonly copyState: CopyState;
}
export interface TunnelQrControllerOptions {
    readonly pollMs?: number;
}
interface FocusTarget {
    focus(): void;
}
export declare class TunnelQrController {
    private readonly api;
    private snapshot;
    private readonly listeners;
    private readonly pollMs;
    private pollHandle;
    private inFlight;
    private activeAbort;
    private disposed;
    private restoreFocus;
    constructor(api: TunnelClientApi, options?: TunnelQrControllerOptions);
    subscribe: (listener: () => void) => (() => void);
    getSnapshot: () => TunnelQrOverlayState;
    open(target?: FocusTarget | null): Promise<void>;
    close(): void;
    handleBackdrop: () => void;
    handleKeyDown: (event: Pick<KeyboardEvent, "key">) => void;
    refresh(): Promise<void>;
    restart(): Promise<void>;
    copyUrl(): Promise<void>;
    dispose(): void;
    private runExclusive;
    private schedulePoll;
    private clearPoll;
    private publish;
}
export {};
//# sourceMappingURL=store.d.ts.map