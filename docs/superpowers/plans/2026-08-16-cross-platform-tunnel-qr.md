# Cross-Platform Tunnel and QR Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `dsh-tunnel-qr-plugin` into one installable DSH bundle that automatically runs a free Cloudflare Quick Tunnel, protects the public entry with one-time QR login, and provides the existing right-bottom QR interface on macOS, Windows, and Linux.

**Architecture:** The Host entry owns a verified `cloudflared` binary, a loopback authentication proxy, in-memory QR credentials, the tunnel process, and no-cache status/action routes. The Client entry registers a React surface in `shell.overlay`, requests dynamic QR data from the Host, and renders state and recovery controls. The repository ships complete built artifacts so a pinned GitHub install does not require an install-time build script.

**Tech Stack:** TypeScript ESM, Node.js 22 `http`/`https`/`crypto`/`child_process`, Cordis effects and services, DSH Host Webserver and Client slots, React, `qrcode`, `tar`, Vitest, tsdown.

---

## File Map

- `src/config.ts`: validated deployment configuration and resolved defaults.
- `src/contracts.ts`: Host/client JSON response types and tunnel state discriminants.
- `src/artifacts.ts`: exact platform/architecture to Cloudflare artifact mapping.
- `src/download.ts`: atomic download, SHA-256 verification, cache publication, permissions.
- `src/credentials.ts`: single-use QR tokens and public-session cookie records.
- `src/rate-limit.ts`: bounded login attempt accounting.
- `src/proxy.ts`: public landing page, login exchange, authenticated HTTP/WebSocket proxy.
- `src/tunnel-process.ts`: child-process adapter and Quick Tunnel URL parsing.
- `src/tunnel-manager.ts`: tunnel state machine, backoff, generation changes, restart/dispose.
- `src/service.ts`: lifecycle composition and state/action API used by routes.
- `src/routes.ts`: DSH loopback status, QR, refresh, and restart routes.
- `src/index.ts`: small Cordis plugin entry and configuration schema.
- `src/client/api.ts`: response validation and browser requests.
- `src/client/store.ts`: immutable client state/controller with in-flight guards.
- `src/client/TunnelQrOverlay.tsx`: right-bottom trigger and accessible dialog.
- `src/client/tunnel-qr.module.css`: DSH-compatible responsive styles.
- `src/client/index.ts`: `shell.overlay` registration and cleanup.
- `scripts/client-bundle.ts`: standalone adaptation of the official DSH client bundle wrapper and purity gate.
- `tests/*.spec.ts`: Host unit and integration tests.
- `tests/client/*.client.spec.tsx`: jsdom slot/UI tests.
- `.github/workflows/ci.yml`: macOS, Windows, Linux build and keyless tests.

### Task 1: Make the Repository a Standalone, Reproducible DSH Bundle

**Files:**
- Modify: `package.json`
- Replace: `tsconfig.json`
- Create: `tsconfig.host.json`
- Create: `tsconfig.client.json`
- Replace: `tsdown.config.ts`
- Create: `scripts/client-bundle.ts`
- Create: `vitest.config.ts`
- Create: `pnpm-lock.yaml`
- Modify: `cordis.patch.yml`
- Delete: `assets/dsh-public-qr.png`

- [ ] **Step 1: Write a failing manifest test**

Create `tests/package.spec.ts` with a test that loads `package.json` and asserts: package name `dsh-tunnel-qr-plugin`; no `workspace:` ranges; Host and `./client` exports; `dsh.bundle.patch`; `dsh.client.platform === 'web'`; `files` includes `lib`, patch, README, and license; no credential fields in `cordis.patch.yml`; and no static QR asset.

```ts
import { access, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('distribution manifest', () => {
  it('is installable outside the DSH monorepo', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as Record<string, any>
    expect(manifest.name).toBe('dsh-tunnel-qr-plugin')
    expect(JSON.stringify(manifest)).not.toContain('workspace:')
    expect(manifest.exports['.']).toBeDefined()
    expect(manifest.exports['./client']).toBeDefined()
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client.platform).toBe('web')
    expect(await readFile('cordis.patch.yml', 'utf8')).not.toMatch(/username|password/i)
    await expect(access('assets/dsh-public-qr.png')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the test and verify the current repository fails**

Run: `pnpm exec vitest run tests/package.spec.ts`

Expected: FAIL because the current package name, workspace ranges, credential patch, and static asset violate the standalone bundle requirements.

- [ ] **Step 3: Replace the standalone build metadata**

Set public dependency ranges from the installed target DSH package metadata, add `qrcode`, `tar`, `react`, `vitest`, `jsdom`, `tsdown`, `typescript`, and type packages, and define these scripts:

```json
{
  "scripts": {
    "typecheck": "tsc -p tsconfig.host.json --noEmit && tsc -p tsconfig.client.json --noEmit",
    "build:types": "tsc -p tsconfig.host.json && tsc -p tsconfig.client.json",
    "bundle": "tsdown",
    "build": "pnpm build:types && pnpm bundle",
    "test": "vitest run",
    "verify": "pnpm typecheck && pnpm test && pnpm build && git diff --check"
  }
}
```

Adapt the official `packages/client/tsdown.client.ts` wrapper into `scripts/client-bundle.ts`, retaining the module-loader wrapper, platform externals, CSS Modules injection, sourcemaps, `clean: false`, and the `@deepseek-ai/*` purity gate. Use separate Host and Client TypeScript programs and make `tsdown.config.ts` emit `lib/index.js` plus `lib/client.js` from the compiled type tree.

Use this patch with no credential environment variables:

```yaml
- insert:
    - id: tunnel-qr
      name: dsh-tunnel-qr-plugin
      config: {}
```

- [ ] **Step 4: Generate the lockfile and run the baseline checks**

Run: `pnpm install && pnpm exec vitest run tests/package.spec.ts && pnpm typecheck && pnpm build`

Expected: all commands PASS and `lib/index.js`, `lib/client.js`, and both declaration entry points exist.

- [ ] **Step 5: Commit the standalone baseline**

```bash
git add package.json pnpm-lock.yaml cordis.patch.yml tsconfig*.json tsdown.config.ts scripts vitest.config.ts tests/package.spec.ts assets
git commit -m "build: make tunnel plugin standalone"
```

### Task 2: Define Configuration, Public State, and Artifact Resolution

**Files:**
- Create: `src/config.ts`
- Create: `src/contracts.ts`
- Create: `src/artifacts.ts`
- Create: `tests/config.spec.ts`
- Create: `tests/artifacts.spec.ts`

- [ ] **Step 1: Write failing tests for defaults and exact artifact selection**

Cover `darwin/x64`, `darwin/arm64`, `linux/x64`, `linux/arm64`, `win32/x64`, and `win32/arm64`. Assert Windows ARM64 maps explicitly to the official AMD64 executable with `requiresX64Emulation: true`; unsupported pairs return a typed unsupported result.

```ts
expect(resolveArtifact('win32', 'arm64')).toEqual({
  asset: 'cloudflared-windows-amd64.exe',
  executable: 'cloudflared.exe',
  archive: 'raw',
  requiresX64Emulation: true,
})
expect(resolveArtifact('freebsd', 'x64')).toEqual({ ok: false, code: 'unsupported-platform' })
```

Assert configuration defaults include a fixed Cloudflare version, five-minute QR tokens, bounded session lifetime, startup timeout, download timeout, retry count, and backoff range.

- [ ] **Step 2: Run the focused tests and verify missing modules fail**

Run: `pnpm exec vitest run tests/config.spec.ts tests/artifacts.spec.ts`

Expected: FAIL with unresolved `src/config.ts` and `src/artifacts.ts` imports.

- [ ] **Step 3: Implement discriminated contracts and exact maps**

Define `TunnelSnapshot` as a closed union with `starting`, `ready`, `reconnecting`, `failed`, and `unsupported` variants. Every variant includes `generation` and `updatedAt`; only `ready` includes `publicUrl`. Define JSON response types for status and QR creation.

Implement artifact selection as a literal record keyed by `${NodeJS.Platform}/${NodeJS.Architecture}`. Do not infer filenames or fall back to a neighboring architecture. The Windows ARM64 key deliberately points to AMD64 with the emulation flag.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm exec vitest run tests/config.spec.ts tests/artifacts.spec.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit contracts and artifact mapping**

```bash
git add src/config.ts src/contracts.ts src/artifacts.ts tests/config.spec.ts tests/artifacts.spec.ts
git commit -m "feat: define tunnel platform contracts"
```

### Task 3: Download and Verify cloudflared Atomically

**Files:**
- Create: `src/download.ts`
- Create: `tests/download.spec.ts`

- [ ] **Step 1: Write failing filesystem and HTTP fixture tests**

Use a temporary directory and local HTTP server. Test a successful raw executable, successful `.tgz` extraction, checksum mismatch, interrupted response, cached verified reuse, concurrent calls collapsing to one download, and executable permission on POSIX.

```ts
await expect(ensureCloudflared({ ...fixture, expectedSha256: '00'.repeat(32) }))
  .rejects.toMatchObject({ code: 'checksum-mismatch' })
expect(await readFile(existingVerifiedPath)).toEqual(previousBytes)
```

- [ ] **Step 2: Verify the tests fail before implementation**

Run: `pnpm exec vitest run tests/download.spec.ts`

Expected: FAIL with unresolved `ensureCloudflared`.

- [ ] **Step 3: Implement verified cache publication**

Implement `ensureCloudflared(options): Promise<string>` with an in-flight promise keyed by destination. Download to a uniquely named sibling temporary file, enforce timeout and maximum response size, hash bytes while streaming, extract only the expected archive member for Darwin tarballs, reject redirects outside HTTPS, then publish with no-clobber semantics. On POSIX set mode `0o700`. Write a sidecar JSON containing version, asset, and digest only after executable publication.

The checksum table must be reviewed against the fixed Cloudflare release during implementation and tested mechanically so every artifact map entry has an expected digest.

- [ ] **Step 4: Run the focused tests**

Run: `pnpm exec vitest run tests/download.spec.ts`

Expected: PASS with no network access outside the local fixture server.

- [ ] **Step 5: Commit the downloader**

```bash
git add src/download.ts tests/download.spec.ts
git commit -m "feat: verify and cache cloudflared"
```

### Task 4: Implement Single-Use QR Credentials and Rate Limits

**Files:**
- Create: `src/credentials.ts`
- Create: `src/rate-limit.ts`
- Create: `tests/credentials.spec.ts`
- Create: `tests/rate-limit.spec.ts`

- [ ] **Step 1: Write failing deterministic-clock tests**

Test token creation, digest-only storage, single consumption, expiry, tunnel-generation invalidation, session-cookie validation, session expiry, global reset, source rate limit, and bounded map pruning.

```ts
const issued = credentials.issueQrToken(7)
const exchanged = credentials.exchangeQrToken(issued.token, 7)
expect(exchanged.ok).toBe(true)
expect(credentials.exchangeQrToken(issued.token, 7)).toEqual({ ok: false, code: 'invalid-token' })
expect(credentials.exchangeQrToken(credentials.issueQrToken(7).token, 8))
  .toEqual({ ok: false, code: 'invalid-token' })
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm exec vitest run tests/credentials.spec.ts tests/rate-limit.spec.ts`

Expected: FAIL with missing classes.

- [ ] **Step 3: Implement in-memory digest records**

Use `randomBytes(32)` for tokens and session ids, base64url encoding, SHA-256 digests as map keys, explicit expiry timestamps, and `timingSafeEqual` for fixed-length presented cookie digests. Expose only `issueQrToken`, `exchangeQrToken`, `validateSession`, `invalidateGeneration`, `prune`, and `clear`.

Implement a fixed-window limiter with per-source and global caps. The caller supplies the normalized source key; proxy-boundary tests own proxy-header trust behavior.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm exec vitest run tests/credentials.spec.ts tests/rate-limit.spec.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit authentication primitives**

```bash
git add src/credentials.ts src/rate-limit.ts tests/credentials.spec.ts tests/rate-limit.spec.ts
git commit -m "feat: add one-time QR credentials"
```

### Task 5: Build the Loopback Authentication Proxy

**Files:**
- Create: `src/landing-page.ts`
- Create: `src/proxy.ts`
- Create: `tests/proxy.spec.ts`

- [ ] **Step 1: Write failing HTTP and WebSocket integration tests**

Start a fixture DSH target and proxy on OS-assigned loopback ports. Assert unauthenticated `/` returns `401`, `/dsh-qr-login` returns a self-contained CSP-protected page, malformed and oversized POST bodies return `400`/`413`, successful exchange returns `204` plus secure cookie, authenticated HTTP forwards method/path/body/headers, and authenticated WebSocket upgrade receives `101`. Assert spoofed forwarding headers cannot bypass source accounting.

```ts
expect(login.headers.get('set-cookie')).toMatch(/HttpOnly; Secure; SameSite=Strict/)
expect(await fetch(publicUrl)).toMatchObject({ status: 401 })
expect((await fetch(publicUrl, { headers: { cookie } })).status).toBe(200)
```

- [ ] **Step 2: Run the integration test and verify failure**

Run: `pnpm exec vitest run tests/proxy.spec.ts`

Expected: FAIL because the proxy does not exist.

- [ ] **Step 3: Implement the landing page and authenticated forwarding**

The landing page must use an inline script authorized by a per-response CSP nonce, read `location.hash`, immediately remove it with `history.replaceState`, POST bounded JSON, and redirect to `/` only after `204`. It loads no remote asset.

The proxy must bind only `127.0.0.1`, strip hop-by-hop headers, set `Host` for the DSH target, never trust public `X-Forwarded-For` as an authentication signal, and use the same session-cookie check for HTTP and upgrades. Return generic `503` when the target cannot be reached. Track and destroy owned sockets during disposal.

- [ ] **Step 4: Run proxy tests**

Run: `pnpm exec vitest run tests/proxy.spec.ts`

Expected: PASS, including HTTP and WebSocket paths.

- [ ] **Step 5: Commit the proxy**

```bash
git add src/landing-page.ts src/proxy.ts tests/proxy.spec.ts
git commit -m "feat: protect the public tunnel proxy"
```

### Task 6: Manage the Quick Tunnel Process and Restart State Machine

**Files:**
- Create: `src/tunnel-process.ts`
- Create: `src/tunnel-manager.ts`
- Create: `tests/tunnel-process.spec.ts`
- Create: `tests/tunnel-manager.spec.ts`

- [ ] **Step 1: Write failing parser and fake-process tests**

Test parsing only HTTPS `trycloudflare.com` URLs, rejecting unrelated log lines, startup timeout, process exit before ready, bounded exponential backoff, stable-ready reset, explicit restart, address change generation increment, and dispose preventing further restarts.

```ts
expect(parseQuickTunnelUrl('INF +https://sample.trycloudflare.com')).toBe(
  'https://sample.trycloudflare.com',
)
expect(parseQuickTunnelUrl('https://attacker.example')).toBeUndefined()
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm exec vitest run tests/tunnel-process.spec.ts tests/tunnel-manager.spec.ts`

Expected: FAIL with unresolved modules.

- [ ] **Step 3: Implement process ownership and immutable state transitions**

Spawn the exact verified executable with `tunnel --no-autoupdate --url http://127.0.0.1:<proxyPort>`. Use explicit stdio pipes, consume both streams, and keep a bounded diagnostic ring buffer. On Windows terminate the owned process tree through `taskkill /PID <pid> /T /F`; on POSIX start a detached process group and signal the exact negative pid, falling back to the child only when no group exists.

`TunnelManager` exposes `start`, `restart`, `getSnapshot`, `subscribe`, and `dispose`. Serialize transitions through one owned operation queue. Every snapshot is a new frozen object. A new public URL increments generation and calls credential invalidation for the previous generation.

- [ ] **Step 4: Run state-machine tests**

Run: `pnpm exec vitest run tests/tunnel-process.spec.ts tests/tunnel-manager.spec.ts`

Expected: PASS with fake clocks and fake child processes.

- [ ] **Step 5: Commit tunnel lifecycle management**

```bash
git add src/tunnel-process.ts src/tunnel-manager.ts tests/tunnel-process.spec.ts tests/tunnel-manager.spec.ts
git commit -m "feat: manage quick tunnel lifecycle"
```

### Task 7: Compose the Host Service and DSH Routes

**Files:**
- Create: `src/service.ts`
- Create: `src/routes.ts`
- Replace: `src/index.ts`
- Create: `tests/routes.spec.ts`
- Create: `tests/plugin.spec.ts`

- [ ] **Step 1: Write failing service and real-loader tests**

Test startup ordering: DSH Webserver ready, proxy bind, binary resolution, tunnel start. Test shutdown ordering: tunnel stopped before proxy closes. Test `GET /dsh-tunnel/status`, `POST /dsh-tunnel/qr`, and `POST /dsh-tunnel/restart`, method rejection, request-size limits, `no-store`, and QR PNG generated from a fragment login URL. Add one Cordis loader test that applies `cordis.patch.yml` with a fake downloader/process adapter and observes a ready state.

```ts
expect(status.headers['cache-control']).toBe('no-store')
expect(qr.body.loginUrl).toMatch(/^https:\/\/[^/]+\.trycloudflare\.com\/dsh-qr-login#/)
expect(qr.body.qrDataUrl).toMatch(/^data:image\/png;base64,/)
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm exec vitest run tests/routes.spec.ts tests/plugin.spec.ts`

Expected: FAIL because the new Host entry is not implemented.

- [ ] **Step 3: Implement the service and thin plugin entry**

`TunnelQrService` owns downloader, credentials, proxy, and manager. It derives the DSH target from `ctx.webServer.host` and `ctx.webServer.port`, but always targets loopback even if DSH listens on all interfaces. Its QR method refuses non-ready state and uses `qrcode.toDataURL(loginUrl, { errorCorrectionLevel: 'M', margin: 2, width: 320 })`.

The Cordis entry keeps `inject = ['webServer']`, validates all tunables with Schemastery, constructs the service inside an effect, awaits startup through the service lifecycle, registers each route with a disposer, and disposes all resources on fiber teardown. Remove the static PNG and credential JSON routes completely.

- [ ] **Step 4: Run Host tests and build**

Run: `pnpm exec vitest run tests/routes.spec.ts tests/plugin.spec.ts && pnpm typecheck && pnpm build`

Expected: PASS and no emitted artifact contains `DSH_TUNNEL_AUTH_USERNAME`, `DSH_TUNNEL_AUTH_PASSWORD`, or the old base64 PNG.

- [ ] **Step 5: Commit Host composition**

```bash
git add src/index.ts src/service.ts src/routes.ts tests/routes.spec.ts tests/plugin.spec.ts lib
git commit -m "feat: compose automatic tunnel host service"
```

### Task 8: Replace the Credential Dialog with the Dynamic shell.overlay UI

**Files:**
- Create: `src/client/api.ts`
- Create: `src/client/store.ts`
- Create: `src/client/TunnelQrOverlay.tsx`
- Create: `src/client/tunnel-qr.module.css`
- Replace: `src/client/index.ts`
- Create: `tests/client/store.client.spec.ts`
- Create: `tests/client/overlay.client.spec.tsx`

- [ ] **Step 1: Write failing client controller and slot tests**

Use jsdom and DSH `SlotTestRuntime`. Assert registration into `shell.overlay` with id `tunnel-qr`; trigger remains at the current right-bottom offset; opening requests a fresh QR; the dialog contains no credential labels; status changes update without layout shifts; copy, refresh, restart, Escape, backdrop, focus restore, and dispose work; only one poll/request is in flight; and a 360x640 viewport keeps all controls inside the viewport.

```ts
expect(runtime.entries('shell.overlay').map(entry => entry.options.id)).toContain('tunnel-qr')
expect(screen.queryByText(/账号|密码|username|password/i)).toBeNull()
await user.click(screen.getByRole('button', { name: '公网访问二维码' }))
expect(await screen.findByRole('img', { name: 'DSH 公网访问二维码' })).toBeVisible()
```

- [ ] **Step 2: Run client tests and verify the old direct-DOM UI fails**

Run: `pnpm exec vitest run tests/client/store.client.spec.ts tests/client/overlay.client.spec.tsx`

Expected: FAIL because the current entry does not use slots and still renders credentials.

- [ ] **Step 3: Implement validated API, immutable store, and React overlay**

`api.ts` validates every response field before returning it. `TunnelQrController` owns status polling, fresh QR loading, refresh, restart, last-good state, generation guards, and disposal. State updates replace the whole snapshot rather than mutating it.

Register with:

```ts
export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'tunnel-qr',
    order: 100,
  }, TunnelQrOverlay))
}
```

Use Lucide's QR, copy, refresh, external-link, and close icons only if those values are available in the DSH client module table; otherwise use the existing DSH primitive/icon platform package verified from `web/src/platform.ts`. Do not inline a second React runtime or manually draw SVG. Keep cards at 8px radius or less, add `pointer-events` only on the owned trigger/dialog, and provide tooltips for icon-only controls.

- [ ] **Step 4: Run client tests, typecheck, and bundle purity checks**

Run: `pnpm exec vitest run tests/client && pnpm typecheck && pnpm build`

Expected: PASS; the bundle wrapper reports no unknown `@deepseek-ai/*` runtime import.

- [ ] **Step 5: Commit the integrated QR UI**

```bash
git add src/client tests/client lib/client.js lib/types/client
git commit -m "feat: integrate dynamic tunnel QR interface"
```

### Task 9: Document Installation and Add Cross-Platform CI

**Files:**
- Replace: `README.md`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-08-16-cross-platform-tunnel-qr-design.md`

- [ ] **Step 1: Write a failing documentation/distribution test**

Extend `tests/package.spec.ts` to assert README contains exactly one primary GitHub install command pinned to a 40-character commit (`github:13323232dong/dsh-tunnel-qr-plugin#[0-9a-f]{40}`), states no Cloudflare account is required, lists the Windows ARM64 x64-emulation requirement, and contains no Basic Auth setup.

- [ ] **Step 2: Run the test and verify current README fails**

Run: `pnpm exec vitest run tests/package.spec.ts`

Expected: FAIL because README still describes static QR and Basic Auth.

- [ ] **Step 3: Rewrite README and add the CI matrix**

Document prerequisites, the single official install command, restart behavior, first-start download, changing Quick Tunnel addresses, QR login, supported platforms, troubleshooting states, update/uninstall commands, and the security model. Do not claim Windows ARM64 native support.

Configure CI for `ubuntu-latest`, `windows-latest`, and `macos-latest` with Node 22 and pnpm, running `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Add an artifact-resolution job that exercises ARM64 mappings without requiring ARM64 runners.

- [ ] **Step 4: Run repository verification**

Run: `pnpm verify`

Expected: PASS with no uncommitted build drift.

- [ ] **Step 5: Commit documentation and CI**

```bash
git add README.md .github/workflows/ci.yml package.json tests/package.spec.ts docs lib
git commit -m "docs: publish automatic tunnel installation"
```

### Task 10: Verify a Clean GitHub Install and Real Tunnel Acceptance

**Files:**
- Create: `scripts/verify-git-install.mjs`
- Create: `tests/install.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Add a clean-profile installation test**

The script creates a temporary `DSH_HOME`, installs the package from a committed local Git URL first, verifies the profile dependency and `dsh.profile.bundles`, runs `--dump-config`, checks every export exists, starts the Web profile with fake Cloudflare adapters for the keyless lane, and removes only its exact temporary directory.

- [ ] **Step 2: Run against the committed local repository**

Run: `node scripts/verify-git-install.mjs --source "git+file://$PWD"`

Expected: PASS without resolving any `workspace:` dependency or using files outside the Git commit.

- [ ] **Step 3: Run security and dependency checks**

Run: `pnpm audit --audit-level high && rg -n 'password|secret|token|api[_-]?key' src lib cordis.patch.yml README.md`

Expected: audit has no high-severity finding. Every search result is a type, ephemeral credential operation, cookie name, test, or security documentation; no hardcoded credential exists.

- [ ] **Step 4: Perform the real acceptance run**

Install from a pinned GitHub commit into a new temporary DSH profile, start it, wait for `ready`, open the local DSH page, display the right-bottom QR dialog, and scan the current code. Verify mobile navigation reaches DSH without credential entry, an unauthenticated browser gets `401`, HTTP works, WebSocket returns `101`, an existing session opens, “加载更早” adds history, workspace directory selection works, tunnel restart changes the address, and the previous QR token/session no longer authenticates.

Record the exact commands and results in the implementation PR or release notes; do not place live Quick Tunnel URLs or cookies in the repository.

- [ ] **Step 5: Run final checks and commit verification tooling**

Run: `pnpm verify && node scripts/verify-git-install.mjs --source "git+file://$PWD" && git diff --check`

Expected: all commands PASS.

```bash
git add scripts/verify-git-install.mjs tests/install.spec.ts README.md
git commit -m "test: verify clean tunnel plugin installation"
```

### Task 11: Review, Push, and Reinstall from the Public Repository

**Files:**
- Review: all changed files

- [ ] **Step 1: Review the complete diff for correctness and security**

Inspect resource disposal, child-process targets, redirect policy, archive extraction, input validation, cookie flags, rate limiting, secret logging, platform mappings, client imports, and README accuracy. Fix all critical and high findings with focused tests before continuing.

- [ ] **Step 2: Run the final focused verification once**

Run: `pnpm verify && git diff --check && git status --short`

Expected: checks PASS and the worktree contains only intended committed artifacts.

- [ ] **Step 3: Push the reviewed branch**

Run: `git push -u origin feat/cross-platform-tunnel-qr`

Expected: the branch is available in `13323232dong/dsh-tunnel-qr-plugin`; do not force-push unless an explicitly reviewed history rewrite is required.

- [ ] **Step 4: Install the exact remote commit into a fresh profile**

Run:

```bash
PLUGIN_COMMIT="$(git rev-parse HEAD)"
DSH_TEST_HOME="$(mktemp -d)"
DSH_HOME="$DSH_TEST_HOME" npx -p @deepseek-ai/dsh dsh plugin --profile tunnel-test add "github:13323232dong/dsh-tunnel-qr-plugin#$PLUGIN_COMMIT"
```

Expected: installation succeeds without `allowBuilds`, the bundle appears in `--dump-config`, and startup loads both Host and Client entries.

- [ ] **Step 5: Update README only if the verified command differs**

If the exact remote installation exposed a command or prerequisite difference, change README to the observed path, rerun the documentation test, commit the correction, and repeat the clean remote install. Otherwise make no documentation-only churn.
