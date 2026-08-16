import { createTunnelClientApi } from './api.js';
import { createTunnelQrOverlayComponent } from './TunnelQrOverlay.js';
import { TunnelQrController } from './store.js';
export const inject = ['slots'];
export function apply(ctx) {
    const controller = new TunnelQrController(createTunnelClientApi());
    const component = createTunnelQrOverlayComponent(controller);
    const unregister = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'tunnel-qr',
        order: 100,
    }, component));
    ctx.effect(() => () => {
        unregister();
        controller.dispose();
    }, 'tunnel-qr client overlay');
}
//# sourceMappingURL=index.js.map