# Cross-Platform Tunnel and QR Login Design

## Objective

`dsh-tunnel-qr-plugin` is the single installation unit for publishing a DeepSeek Harness Web profile through a free Cloudflare Quick Tunnel. Installing the bundle provides tunnel lifecycle management, public-entry authentication, dynamic QR login, and the DSH right-bottom QR interface. There is no separate QR plugin and no Cloudflare account or domain requirement.

The first release supports macOS, Windows, and Linux. macOS and Linux use Cloudflare's native x64 or ARM64 binary. Windows x64 uses the official AMD64 binary; Windows ARM64 uses that same official binary through the operating system's x64 emulation because Cloudflare does not publish a native Windows ARM64 artifact.

## User Experience

The plugin starts with the DSH Web profile. On first use it downloads and verifies `cloudflared`, starts a loopback authentication proxy, starts a Quick Tunnel, and obtains a temporary `trycloudflare.com` address. The DSH client displays a QR button at the current right-bottom position.

Opening the dialog shows the tunnel state, current public address, a dynamic QR code, and copy, refresh, restart, and close controls. It never displays a username, password, login token, or other credential. Scanning the QR code authenticates the mobile browser and redirects it directly to DSH.

The public address can change whenever Quick Tunnel restarts. The plugin detects the change, invalidates QR tokens issued for the previous address, and refreshes the dialog automatically.

## Package Architecture

The repository distributes one DSH bundle with Host and Client entries.

### Tunnel Manager

The Tunnel Manager resolves the supported Cloudflare artifact from `process.platform` and `process.arch`, downloads a configured fixed version, verifies it against a trusted SHA-256 value, and publishes the verified binary into a plugin-owned cache directory. Downloads use a temporary file and become available only after verification. A failed or interrupted download cannot replace an already verified binary.

The manager starts `cloudflared tunnel --url <proxy-loopback-url>` without a Cloudflare account. It parses the assigned HTTPS address from structured process output, owns stdout and stderr consumption, detects process exit, and restarts with bounded exponential backoff. It publishes immutable state snapshots for the Host API. It must not register a platform service or require administrator privileges.

### Authentication Proxy

The Authentication Proxy listens only on loopback and forwards authenticated HTTP and WebSocket traffic to the DSH Web server. Cloudflare connects to this proxy rather than directly to DSH. Unknown methods and malformed upgrade requests fail closed.

The proxy owns the unauthenticated QR landing page and login exchange endpoint. All other public requests require a valid plugin session cookie. When the DSH target is unavailable, the proxy returns a generic `503` response without local paths, process output, or stack traces.

### QR Credential Service

The credential service creates cryptographically random, single-use login tokens on demand. Tokens expire after five minutes, are associated with the current tunnel generation, and exist only in process memory. Token lookup uses stored digests and sensitive comparisons use constant-time primitives where applicable.

Successful exchange consumes the token and creates a random public-session identifier. The browser receives an `HttpOnly; Secure; SameSite=Strict` cookie. The service stores only the server-side digest and expiry for that session. Plugin restart invalidates all QR tokens and public sessions.

### Tunnel HTTP API

The Host entry registers authenticated loopback routes for client status, QR generation, QR refresh, and explicit tunnel restart. Responses use `Cache-Control: no-store`. Request methods, content types, request-body sizes, and input fields are validated at the HTTP boundary.

The status response distinguishes `starting`, `ready`, `reconnecting`, `failed`, and `unsupported`. Errors carry a stable public code and a concise user-facing message; internal diagnostics remain in Host logs.

### Client UI

The Client entry contributes through the DSH `shell.overlay` slot. It does not depend on hashed DOM classes or install an unrelated navigation surface. The overlay contains the fixed right-bottom trigger and its dialog.

The dialog follows the current DSH visual system, supports narrow screens, restores focus to the trigger, closes with Escape or the close control, and exposes meaningful accessible labels. It polls or subscribes with one in-flight request at a time, retains the last successful state during transient failures, and removes all registrations, listeners, timers, styles, and DOM state during disposal.

## Authentication Flow

1. The authenticated local DSH client requests a fresh QR code.
2. The Host creates a five-minute, single-use token tied to the current tunnel generation.
3. The QR URL is `https://<quick-tunnel-host>/dsh-qr-login#<token>`. The fragment is not included in HTTP requests, intermediary logs, or referrer headers.
4. The plugin-owned landing page reads the fragment and sends it in a bounded JSON `POST` to `/dsh-qr-login`.
5. The proxy validates and consumes the token, creates a public session, and sets the secure cookie.
6. The landing page removes the fragment from browser history and redirects to `/`.
7. Subsequent HTTP and WebSocket requests are accepted only while the public session remains valid.

The login exchange is rate-limited by source and by a global bounded failure budget. It has no third-party scripts, fonts, analytics, or remote assets. Direct loopback access to DSH retains existing DSH behavior; tunnel authentication protects only the Cloudflare entry.

## Cross-Platform Artifacts

The artifact table explicitly maps supported platform and architecture pairs to official Cloudflare release assets. No fuzzy filename selection or architecture fallback is allowed.

- macOS: x64 and ARM64
- Windows: x64; ARM64 through Windows x64 emulation
- Linux: x64 and ARM64

The fixed Cloudflare version and its expected SHA-256 values are release configuration, not credentials. Windows uses the official AMD64 `.exe` artifact for both x64 and ARM64, with the ARM64 mapping explicitly named and tested as an emulation requirement rather than an architecture fallback. macOS and Linux set user executable permission after verification. Unsupported pairs produce the `unsupported` state and do not attempt to execute another artifact.

The cache root is derived from the DSH/plugin data location, never from the repository or current working directory. Uninstall cleanup removes only paths owned and positively identified by this plugin. Runtime shutdown removes temporary files and terminates owned process trees, while the verified binary cache remains available for a later reinstall unless the DSH plugin uninstall lifecycle explicitly requests data removal.

## Lifecycle and Failure Handling

Startup waits for the DSH Web server dependency, binds the proxy, then launches Cloudflare. The public entry is never started before the authentication proxy is listening. Shutdown reverses ownership: stop accepting public traffic, terminate `cloudflared`, drain or close proxy connections, dispose routes, and release timers and listeners.

The tunnel restarts only for recoverable failures. Backoff is bounded and reset after a stable ready interval. A user-triggered restart cancels the current backoff and starts one new generation. Concurrent download, start, restart, and QR refresh requests collapse behind owned in-flight operations.

Failure states include unsupported platform, download failure, checksum mismatch, execution denial, tunnel startup timeout, unexpected process exit, address parse failure, proxy bind failure, and unavailable DSH target. Each state provides a retry decision and preserves detailed diagnostics without exposing them to public clients.

## Configuration

Deployment-varying values are validated DSH plugin configuration fields. Initial fields include the fixed `cloudflared` version, download timeout, tunnel startup timeout, login-token lifetime, public-session lifetime, restart limit, backoff range, and optional binary cache directory. Defaults are suitable for installation without manual configuration.

There are no username or password fields. The bundle patch activates the plugin with defaults and does not read credential environment variables.

## Distribution

The repository remains the standalone distribution source. It must have a valid `dsh.bundle` patch, real Host and Client exports, non-workspace dependency ranges, and complete built artifacts required by installation.

The preferred user command is the official profile workflow pinned to a reviewed commit:

```sh
PLUGIN_COMMIT="$(git rev-parse HEAD)"
npx -p @deepseek-ai/dsh dsh plugin --profile web add "github:13323232dong/dsh-tunnel-qr-plugin#$PLUGIN_COMMIT"
```

The final README will contain only a command proven from a clean `DSH_HOME`. Installation must not depend on files from a DeepSeek Harness monorepo checkout. The implementation will choose either a self-contained approved `prepare` flow or committed complete `lib/` artifacts after verifying the least-interactive official installation path.

## Verification

Unit tests cover artifact resolution, checksum enforcement, state transitions, retry policy, token expiry and consumption, cookie validation, request validation, and cleanup. Integration tests cover the local proxy, HTTP forwarding, WebSocket upgrade, unauthenticated rejection, QR exchange, cookie access, DSH target failure, and process lifecycle with controlled fixtures.

Client tests cover slot registration, state rendering, dialog controls, fresh QR requests, address changes, failure recovery, narrow layouts, accessibility behavior, and complete disposal. Tests run without a real Cloudflare account.

Cross-platform CI builds and runs supported non-network tests on macOS, Windows, and Linux. Final distribution verification uses a new temporary `DSH_HOME` and profile, installs from a pinned Git commit with the README command, inspects the resolved bundle, starts the assembled Web profile, and verifies the Host routes and Client roster.

A real end-to-end acceptance run starts Quick Tunnel, scans a newly generated QR code, reaches DSH without entering credentials, verifies HTTP and WebSocket operation, opens existing sessions and workspaces, loads earlier conversation history, refreshes the QR code, restarts the tunnel, and confirms that the old address or credentials no longer grant access.

## Non-Goals

The first release does not provide a permanent hostname, Cloudflare account onboarding, custom domains, Cloudflare Access configuration, LAN exposure, background operation after DSH exits, multiple simultaneous tunnels, or migration of previously issued Basic Auth credentials.
