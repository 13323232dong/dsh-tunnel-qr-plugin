import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createTunnelClientApi } from './api.js'
import { createTunnelQrOverlayComponent } from './TunnelQrOverlay.js'
import { TunnelQrController } from './store.js'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  const controller = new TunnelQrController(createTunnelClientApi())
  const component = createTunnelQrOverlayComponent(controller)
  const unregister = ctx.slots.inject('shell.overlay' as never, () => ctx.slots.register({
    name: 'shell.overlay' as never,
    id: 'tunnel-qr',
    order: 100,
  } as never, component as never))
  ctx.effect(() => () => {
    unregister()
    controller.dispose()
  }, 'tunnel-qr client overlay')
}
