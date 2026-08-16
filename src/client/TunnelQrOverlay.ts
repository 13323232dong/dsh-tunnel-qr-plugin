import React, { useSyncExternalStore } from 'react'
import type { MouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TunnelQrController, TunnelQrOverlayState } from './store.js'

export interface TunnelQrOverlayHandlers {
  open(target?: HTMLElement | null): void | Promise<void>
  close(): void
  refresh(): void | Promise<void>
  handleKeyDown(event: Pick<KeyboardEvent, 'key'>): void
  handleBackdrop(): void
}

const buttonStyle: React.CSSProperties = {
  position: 'fixed',
  right: '16px',
  bottom: '18px',
  zIndex: 1000,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  minHeight: '34px',
  padding: '6px 11px',
  border: '1px solid rgba(0,0,0,0.14)',
  borderRadius: '7px',
  background: 'rgba(255,255,255,0.92)',
  color: '#111',
  boxShadow: '0 2px 9px rgba(0,0,0,0.12)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '13px',
  lineHeight: '1',
  pointerEvents: 'auto',
}

const frameStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1100,
  display: 'grid',
  placeItems: 'center',
  padding: '12px',
  pointerEvents: 'none',
}

const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0,0,0,0.48)',
  pointerEvents: 'auto',
}

const panelStyle: React.CSSProperties = {
  position: 'relative',
  boxSizing: 'border-box',
  width: 'min(360px, calc(100vw - 24px))',
  maxWidth: '100%',
  maxHeight: 'min(640px, calc(100vh - 24px))',
  overflow: 'auto',
  padding: '18px',
  border: '1px solid rgba(0,0,0,0.12)',
  borderRadius: '8px',
  background: '#fff',
  color: '#111',
  boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
  pointerEvents: 'auto',
}

const controlRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  marginTop: '12px',
}

const iconButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(0,0,0,0.16)',
  borderRadius: '6px',
  background: 'transparent',
  color: 'inherit',
  padding: '6px 10px',
  cursor: 'pointer',
  font: 'inherit',
}

const qrStyle: React.CSSProperties = {
  display: 'block',
  width: 'min(300px, 100%)',
  aspectRatio: '1 / 1',
  margin: '0 auto',
  objectFit: 'contain',
}

export function createTunnelQrOverlayComponent(controller: TunnelQrController): React.FC {
  return function TunnelQrOverlayComponent() {
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    return buildTunnelQrOverlayView(snapshot, {
      open: target => { void controller.open(target ?? undefined) },
      close: () => { controller.close() },
      refresh: () => { void controller.refresh() },
      handleKeyDown: event => { controller.handleKeyDown(event) },
      handleBackdrop: () => { controller.handleBackdrop() },
    })
  }
}

export function buildTunnelQrOverlayView(
  snapshot: TunnelQrOverlayState,
  handlers: TunnelQrOverlayHandlers,
): React.ReactElement {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'button',
      {
        type: 'button',
        'aria-label': '公网访问二维码',
        title: '公网访问二维码',
        style: buttonStyle,
        onClick: (event: MouseEvent<HTMLButtonElement>) => { void handlers.open(event.currentTarget) },
      },
      React.createElement('span', { 'aria-hidden': 'true', style: { fontSize: '18px' } }, '▦'),
      React.createElement('span', null, '二维码'),
    ),
    !snapshot.open ? null : React.createElement(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '公网访问二维码',
        style: frameStyle,
        onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => { handlers.handleKeyDown(event) },
      },
      React.createElement('div', {
        style: backdropStyle,
        onClick: () => { handlers.handleBackdrop() },
      }),
      React.createElement(
        'section',
        { style: panelStyle },
        React.createElement(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' } },
          React.createElement('h2', { style: { margin: 0, fontSize: '16px' } }, '公网访问二维码'),
          React.createElement('button', {
            type: 'button',
            title: '关闭',
            'aria-label': '关闭二维码',
            autoFocus: true,
            style: { ...iconButtonStyle, fontSize: '18px', padding: '2px 8px' },
            onClick: () => { handlers.close() },
          }, '×'),
        ),
        React.createElement('p', {
          style: { margin: '12px 0 0', fontSize: '12px', color: '#555', minHeight: '18px' },
        }, describeStatus(snapshot)),
        snapshot.qr === null
          ? React.createElement('div', {
            style: {
              display: 'grid',
              placeItems: 'center',
              width: 'min(300px, 100%)',
              aspectRatio: '1 / 1',
              margin: '12px auto 0',
              borderRadius: '8px',
              background: '#f3f4f6',
              color: '#555',
              textAlign: 'center',
              padding: '18px',
            },
          }, snapshot.error ?? '二维码生成后会显示在这里。')
          : React.createElement('img', {
            src: snapshot.qr.qrDataUrl,
            alt: 'DSH 公网访问二维码',
            style: qrStyle,
          }),
        snapshot.error === null ? null : React.createElement(
          'div',
          { role: 'status', style: { marginTop: '10px', color: '#b91c1c', fontSize: '12px' } },
          snapshot.error,
        ),
        React.createElement(
          'div',
          { style: { ...controlRowStyle, justifyContent: 'flex-end' } },
          React.createElement('button', {
            type: 'button',
            title: '刷新二维码',
            'aria-label': '刷新二维码',
            style: iconButtonStyle,
            disabled: snapshot.busy !== 'idle',
            onClick: () => { void handlers.refresh() },
          }, snapshot.busy === 'refreshing' ? '刷新中' : '刷新'),
        ),
      ),
    ),
  )
}

function describeStatus(snapshot: TunnelQrOverlayState): string {
  const status = snapshot.status
  if (status === null) return snapshot.busy === 'refreshing' ? '正在读取公网状态…' : '等待公网状态…'
  switch (status.status) {
    case 'starting':
      return '正在启动内网穿透。'
    case 'ready':
      return '公网地址可用，扫描二维码即可访问。'
    case 'reconnecting':
      return `正在重连公网地址（第 ${status.attempt} 次）。`
    case 'failed':
      return `${status.message}${status.retryable ? ' 可尝试刷新。' : ''}`
    case 'unsupported':
      return status.message
    default:
      return '等待公网状态…'
  }
}
