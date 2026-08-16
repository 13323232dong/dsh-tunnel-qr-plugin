import React from 'react';
import type { TunnelQrController, TunnelQrOverlayState } from './store.js';
export interface TunnelQrOverlayHandlers {
    open(target?: HTMLElement | null): void | Promise<void>;
    close(): void;
    refresh(): void | Promise<void>;
    restart(): void | Promise<void>;
    copyUrl(): void | Promise<void>;
    handleKeyDown(event: Pick<KeyboardEvent, 'key'>): void;
    handleBackdrop(): void;
}
export declare function createTunnelQrOverlayComponent(controller: TunnelQrController): React.FC;
export declare function buildTunnelQrOverlayView(snapshot: TunnelQrOverlayState, handlers: TunnelQrOverlayHandlers): React.ReactElement;
//# sourceMappingURL=TunnelQrOverlay.d.ts.map