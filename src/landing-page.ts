/** Render the public, dependency-free QR login exchange page. */
export function renderLandingPage(nonce: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH 登录</title></head>
<body><main><p id="status">正在验证访问凭证...</p></main>
<script nonce="${nonce}">
(() => {
  const status = document.getElementById('status');
  const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  if (!token) { status.textContent = '二维码无效或已过期'; return; }
  fetch('/dsh-qr-login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token })
  }).then(response => {
    if (response.status !== 204) throw new Error('login rejected');
    location.replace('/');
  }).catch(() => { status.textContent = '二维码无效或已过期'; });
})();
</script></body></html>`
}
