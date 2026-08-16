import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

const BUTTON_CLASS = 'dsh-tunnel-qr-button'
const DIALOG_CLASS = 'dsh-tunnel-qr-dialog'
const STYLE_ID = 'dsh-tunnel-qr-style'

const CSS = `
.dsh-tunnel-qr-button{position:fixed;right:16px;bottom:18px;z-index:1000;display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:6px 11px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:7px;background:color-mix(in srgb,Canvas 92%,transparent);color:CanvasText;box-shadow:0 2px 9px rgb(0 0 0 / 12%);cursor:pointer;font:inherit;font-size:13px;line-height:1;backdrop-filter:blur(8px)}
.dsh-tunnel-qr-button:hover,.dsh-tunnel-qr-button:focus-visible{background:color-mix(in srgb,Canvas 78%,Highlight 22%);outline:2px solid Highlight;outline-offset:2px}
.dsh-tunnel-qr-button span:first-child{font-size:19px;line-height:14px}
.dsh-tunnel-qr-dialog[hidden]{display:none}
.dsh-tunnel-qr-dialog{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;padding:20px}
.dsh-tunnel-qr-backdrop{position:absolute;inset:0;background:rgb(0 0 0 / 48%)}
.dsh-tunnel-qr-panel{position:relative;box-sizing:border-box;width:min(360px,calc(100vw - 40px));padding:18px;border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:8px;background:Canvas;color:CanvasText;box-shadow:0 16px 48px rgb(0 0 0 / 28%)}
.dsh-tunnel-qr-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.dsh-tunnel-qr-header h2{margin:0;font-size:16px;font-weight:600}
.dsh-tunnel-qr-close{width:30px;height:30px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;font-size:24px;line-height:1}
.dsh-tunnel-qr-close:hover,.dsh-tunnel-qr-close:focus-visible{background:color-mix(in srgb,currentColor 10%,transparent);outline:2px solid Highlight;outline-offset:1px}
.dsh-tunnel-qr-image{display:block;width:min(300px,100%);aspect-ratio:1;margin:0 auto;image-rendering:pixelated}
.dsh-tunnel-qr-access{display:grid;gap:7px;margin:14px 0 0;padding:10px 12px;border-radius:6px;background:color-mix(in srgb,CanvasText 6%,transparent);font-size:12px}
.dsh-tunnel-qr-access-row{display:grid;grid-template-columns:36px minmax(0,1fr);gap:8px;margin:0}
.dsh-tunnel-qr-access dt{color:color-mix(in srgb,CanvasText 62%,transparent)}
.dsh-tunnel-qr-access dd{min-width:0;margin:0;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;user-select:all}
.dsh-tunnel-qr-password{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-tunnel-qr-password-toggle{flex:0 0 auto;padding:2px 6px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:5px;background:transparent;color:inherit;cursor:pointer;font:inherit;font-family:inherit;font-size:11px;user-select:none}
.dsh-tunnel-qr-password-toggle:disabled{cursor:default;opacity:.5}
.dsh-tunnel-qr-password-toggle:focus-visible{outline:2px solid Highlight;outline-offset:1px}
.dsh-tunnel-qr-note{margin:14px 0 0;color:color-mix(in srgb,CanvasText 68%,transparent);font-size:12px;line-height:1.5;text-align:center}
@media (max-width:560px){.dsh-tunnel-qr-button{right:10px;bottom:12px}}
`

/** Mount the reusable QR dialog and remove every owned node on plugin dispose. */
export function apply(ctx: ClientContext): void {
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS

  const button = document.createElement('button')
  button.type = 'button'
  button.className = BUTTON_CLASS
  button.setAttribute('aria-label', '打开公网访问二维码')
  button.title = '公网访问二维码'
  button.innerHTML = '<span aria-hidden="true">▦</span><span>二维码</span>'

  const dialog = document.createElement('div')
  dialog.className = DIALOG_CLASS
  dialog.hidden = true
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', '公网访问二维码')
  dialog.innerHTML = '<div class="dsh-tunnel-qr-backdrop" data-qr-close></div><section class="dsh-tunnel-qr-panel"><header class="dsh-tunnel-qr-header"><h2>公网访问二维码</h2><button type="button" class="dsh-tunnel-qr-close" aria-label="关闭二维码" title="关闭">×</button></header><img src="/dsh-public-qr.png" alt="DSH 公网访问二维码" class="dsh-tunnel-qr-image"><dl class="dsh-tunnel-qr-access"><div class="dsh-tunnel-qr-access-row"><dt>账号</dt><dd data-tunnel-username>加载中</dd></div><div class="dsh-tunnel-qr-access-row"><dt>密码</dt><dd class="dsh-tunnel-qr-password"><span data-tunnel-password>加载中</span><button type="button" class="dsh-tunnel-qr-password-toggle" aria-pressed="false" disabled>显示</button></dd></div></dl><p class="dsh-tunnel-qr-note">使用手机扫描后，输入上方账号和密码访问。</p></section>'

  const username = dialog.querySelector<HTMLElement>('[data-tunnel-username]')
  const password = dialog.querySelector<HTMLElement>('[data-tunnel-password]')
  const passwordToggle = dialog.querySelector<HTMLButtonElement>('.dsh-tunnel-qr-password-toggle')
  if (username === null || password === null || passwordToggle === null) throw new Error('ui-tunnel-qr: missing credential fields')

  let passwordValue = ''
  let passwordVisible = false
  const renderPassword = (): void => {
    password.textContent = passwordVisible ? passwordValue : '********'
    passwordToggle.textContent = passwordVisible ? '隐藏' : '显示'
    passwordToggle.setAttribute('aria-pressed', String(passwordVisible))
  }
  const togglePassword = (): void => {
    passwordVisible = !passwordVisible
    renderPassword()
  }

  const loadAccess = async (): Promise<void> => {
    try {
      const response = await fetch('/dsh-tunnel-access.json', { cache: 'no-store', credentials: 'same-origin' })
      const value: unknown = await response.json()
      if (!response.ok || typeof value !== 'object' || value === null) throw new Error('invalid response')
      const record = value as Record<string, unknown>
      if (typeof record.username !== 'string' || typeof record.password !== 'string') throw new Error('invalid credentials')
      username.textContent = record.username
      passwordValue = record.password
      passwordVisible = false
      passwordToggle.disabled = false
      renderPassword()
    } catch {
      username.textContent = '无法加载'
      password.textContent = '无法加载'
      passwordToggle.disabled = true
    }
  }

  const close = (): void => {
    dialog.hidden = true
    button.focus()
  }
  const open = (): void => {
    dialog.hidden = false
    void loadAccess()
    dialog.querySelector<HTMLButtonElement>('.dsh-tunnel-qr-close')?.focus()
  }
  const onDialogClick = (event: Event): void => {
    const target = event.target
    if (target instanceof HTMLElement && (target.matches('[data-qr-close]') || target.matches('.dsh-tunnel-qr-close'))) close()
  }
  const onDialogKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close()
  }

  button.addEventListener('click', open)
  passwordToggle.addEventListener('click', togglePassword)
  dialog.addEventListener('click', onDialogClick)
  dialog.addEventListener('keydown', onDialogKeyDown)
  document.head.append(style)
  document.body.append(button, dialog)

  ctx.effect(() => () => {
    button.removeEventListener('click', open)
    passwordToggle.removeEventListener('click', togglePassword)
    dialog.removeEventListener('click', onDialogClick)
    dialog.removeEventListener('keydown', onDialogKeyDown)
    button.remove()
    dialog.remove()
    style.remove()
  }, 'ui-tunnel-qr: DOM')
}
