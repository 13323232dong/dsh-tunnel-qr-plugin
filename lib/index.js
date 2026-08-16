import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { createServer, request } from "node:http";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
//#region lib/types/artifacts.js
const ARTIFACTS = Object.freeze({
	"darwin/x64": Object.freeze({
		asset: "cloudflared-darwin-amd64.tgz",
		sha256: "f1727723c586500e2092368ae21871b3df7ddfd2cb097f22d81bee4a9c458bb4",
		executable: "cloudflared",
		archive: "tar-gzip",
		requiresX64Emulation: false
	}),
	"darwin/arm64": Object.freeze({
		asset: "cloudflared-darwin-arm64.tgz",
		sha256: "9042c2c5d8b2de78e60f313d5fb31b6c5c1cebde787a3caf1f2c9588084ac442",
		executable: "cloudflared",
		archive: "tar-gzip",
		requiresX64Emulation: false
	}),
	"linux/x64": Object.freeze({
		asset: "cloudflared-linux-amd64",
		sha256: "fcfb02b575a52ca1af2e3267af4e1517bcdeb30ac48c834c69abaed3c0576ad2",
		executable: "cloudflared",
		archive: "raw",
		requiresX64Emulation: false
	}),
	"linux/arm64": Object.freeze({
		asset: "cloudflared-linux-arm64",
		sha256: "7747d94570fb390cf47dcb4f9555c193c6355cda9793f0d878d9049e5d6a7790",
		executable: "cloudflared",
		archive: "raw",
		requiresX64Emulation: false
	}),
	"win32/x64": Object.freeze({
		asset: "cloudflared-windows-amd64.exe",
		sha256: "c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5",
		executable: "cloudflared.exe",
		archive: "raw",
		requiresX64Emulation: false
	}),
	"win32/arm64": Object.freeze({
		asset: "cloudflared-windows-amd64.exe",
		sha256: "c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5",
		executable: "cloudflared.exe",
		archive: "raw",
		requiresX64Emulation: true
	})
});
/** Resolve only explicitly supported pairs; unknown pairs fail closed. */
function resolveArtifact(platform, architecture) {
	const artifact = ARTIFACTS[`${platform}/${architecture}`];
	return artifact === void 0 ? {
		ok: false,
		code: "unsupported-platform",
		platform,
		architecture
	} : {
		ok: true,
		artifact
	};
}
//#endregion
//#region lib/types/config.js
/** Defaults used by the credential-free bundle patch. */
const DEFAULT_TUNNEL_CONFIG = Object.freeze({
	cloudflaredVersion: "2026.8.2",
	downloadTimeoutMs: 3e4,
	tunnelStartupTimeoutMs: 3e4,
	qrTokenLifetimeMs: 3e5,
	publicSessionLifetimeMs: 864e5,
	restartLimit: 5,
	restartBackoffMinMs: 1e3,
	restartBackoffMaxMs: 3e4,
	binaryCacheDirectory: void 0
});
function requirePositiveInteger(name, value) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
}
function requireNonNegativeInteger(name, value) {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
}
/** Resolve partial plugin input into one validated immutable configuration. */
function resolveTunnelConfig(input = {}) {
	const resolved = {
		...DEFAULT_TUNNEL_CONFIG,
		...input
	};
	if (resolved.cloudflaredVersion.length === 0) throw new RangeError("cloudflaredVersion must not be empty");
	requirePositiveInteger("downloadTimeoutMs", resolved.downloadTimeoutMs);
	requirePositiveInteger("tunnelStartupTimeoutMs", resolved.tunnelStartupTimeoutMs);
	requirePositiveInteger("qrTokenLifetimeMs", resolved.qrTokenLifetimeMs);
	requirePositiveInteger("publicSessionLifetimeMs", resolved.publicSessionLifetimeMs);
	requireNonNegativeInteger("restartLimit", resolved.restartLimit);
	requirePositiveInteger("restartBackoffMinMs", resolved.restartBackoffMinMs);
	requirePositiveInteger("restartBackoffMaxMs", resolved.restartBackoffMaxMs);
	if (resolved.restartBackoffMaxMs < resolved.restartBackoffMinMs) throw new RangeError("restartBackoffMaxMs must be greater than or equal to restartBackoffMinMs");
	if (resolved.binaryCacheDirectory !== void 0 && resolved.binaryCacheDirectory.length === 0) throw new RangeError("binaryCacheDirectory must not be empty");
	return Object.freeze(resolved);
}
//#endregion
//#region lib/types/credentials.js
const EMPTY_DIGEST = Buffer.alloc(32);
function requirePositive(name, value) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
}
function digest(value) {
	return createHash("sha256").update(value, "utf8").digest();
}
/** In-memory owner for single-use QR tokens and public browser sessions. */
var QrCredentials = class {
	tokenLifetimeMs;
	sessionLifetimeMs;
	now;
	tokens = /* @__PURE__ */ new Map();
	sessions = /* @__PURE__ */ new Map();
	constructor(options) {
		requirePositive("tokenLifetimeMs", options.tokenLifetimeMs);
		requirePositive("sessionLifetimeMs", options.sessionLifetimeMs);
		this.tokenLifetimeMs = options.tokenLifetimeMs;
		this.sessionLifetimeMs = options.sessionLifetimeMs;
		this.now = options.now ?? Date.now;
	}
	/** Mint one opaque token tied to the current public tunnel generation. */
	issueQrToken(generation) {
		this.prune();
		const token = randomBytes(32).toString("base64url");
		const tokenDigest = digest(token);
		const expiresAt = this.now() + this.tokenLifetimeMs;
		this.tokens.set(tokenDigest.toString("hex"), {
			digest: tokenDigest,
			generation,
			expiresAt
		});
		return {
			token,
			expiresAt
		};
	}
	/** Consume a QR token exactly once and create a public-session cookie value. */
	exchangeQrToken(token, generation) {
		const presentedDigest = digest(token);
		const key = presentedDigest.toString("hex");
		const record = this.tokens.get(key);
		this.tokens.delete(key);
		const digestMatches = timingSafeEqual(record?.digest ?? EMPTY_DIGEST, presentedDigest);
		if (record === void 0 || !digestMatches || record.generation !== generation || record.expiresAt <= this.now()) return {
			ok: false,
			code: "invalid-token"
		};
		const session = randomBytes(32).toString("base64url");
		const sessionDigest = digest(session);
		const expiresAt = this.now() + this.sessionLifetimeMs;
		this.sessions.set(sessionDigest.toString("hex"), {
			digest: sessionDigest,
			expiresAt
		});
		return {
			ok: true,
			session,
			expiresAt
		};
	}
	/**
	* Validate one public-session cookie.
	* Sessions are browser-host scoped by the tunnel hostname, so a reconnect
	* generation must not invalidate an already opened public page.
	*/
	validateSession(session, _generation) {
		const presentedDigest = digest(session);
		const key = presentedDigest.toString("hex");
		const record = this.sessions.get(key);
		const digestMatches = timingSafeEqual(record?.digest ?? EMPTY_DIGEST, presentedDigest);
		if (record === void 0) return false;
		const valid = digestMatches && record.expiresAt > this.now();
		if (!valid) this.sessions.delete(key);
		return valid;
	}
	/** Remove QR tokens associated with a retired public URL. */
	invalidateGeneration(generation) {
		for (const [key, record] of this.tokens) if (record.generation === generation) this.tokens.delete(key);
	}
	/** Remove expired records without exposing stored digests. */
	prune() {
		const now = this.now();
		for (const [key, record] of this.tokens) if (record.expiresAt <= now) this.tokens.delete(key);
		for (const [key, record] of this.sessions) if (record.expiresAt <= now) this.sessions.delete(key);
	}
	/** Drop all authentication state during plugin shutdown. */
	clear() {
		this.tokens.clear();
		this.sessions.clear();
	}
	/** Diagnostic counts that never reveal credential material. */
	counts() {
		this.prune();
		return {
			tokens: this.tokens.size,
			sessions: this.sessions.size
		};
	}
};
//#endregion
//#region lib/types/download.js
const MAX_DOWNLOAD_BYTES = 134217728;
const inFlight = /* @__PURE__ */ new Map();
var CloudflaredDownloadError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.code = code;
		this.name = "CloudflaredDownloadError";
	}
};
async function sha256File(path) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}
function cachePaths(options) {
	const directory = join(options.cacheDirectory, options.version, options.artifact.asset);
	return {
		directory,
		executable: join(directory, options.artifact.executable),
		metadata: join(directory, "verified.json")
	};
}
async function validatedCachedExecutable(options, executable, metadataPath) {
	try {
		const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
		if (metadata.version !== options.version || metadata.asset !== options.artifact.asset || metadata.archiveSha256 !== options.expectedSha256 || typeof metadata.executableSha256 !== "string") return void 0;
		const file = await lstat(executable);
		if (!file.isFile() || file.isSymbolicLink()) return void 0;
		return await sha256File(executable) === metadata.executableSha256 ? executable : void 0;
	} catch (error) {
		if (error.code === "ENOENT" || error instanceof SyntaxError) return void 0;
		throw error;
	}
}
async function downloadAsset(options, destination) {
	const url = new URL(options.downloadUrl ?? `https://github.com/cloudflare/cloudflared/releases/download/${options.version}/${options.artifact.asset}`);
	const isAllowedFixture = options.allowHttpForTests === true && url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "::1");
	if (url.protocol !== "https:" && !isAllowedFixture) throw new CloudflaredDownloadError("download-failed", "cloudflared download URL must use HTTPS");
	const signal = AbortSignal.timeout(options.downloadTimeoutMs ?? 3e4);
	let response;
	try {
		response = await fetch(url, {
			signal,
			redirect: "follow"
		});
	} catch (error) {
		throw new CloudflaredDownloadError("download-failed", "cloudflared download failed", { cause: error });
	}
	const finalUrl = new URL(response.url);
	const finalFixture = options.allowHttpForTests === true && finalUrl.protocol === "http:" && (finalUrl.hostname === "127.0.0.1" || finalUrl.hostname === "::1");
	if (finalUrl.protocol !== "https:" && !finalFixture || !response.ok || response.body === null) throw new CloudflaredDownloadError("download-failed", "cloudflared download returned an invalid response");
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) throw new CloudflaredDownloadError("download-failed", "cloudflared download exceeded the size limit");
	let bytes = 0;
	const limit = new Transform({ transform(chunk, _encoding, callback) {
		bytes += chunk.byteLength;
		callback(bytes > MAX_DOWNLOAD_BYTES ? new CloudflaredDownloadError("download-failed", "cloudflared download exceeded the size limit") : void 0, chunk);
	} });
	try {
		await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(destination, { flags: "wx" }));
	} catch (error) {
		throw error instanceof CloudflaredDownloadError ? error : new CloudflaredDownloadError("download-failed", "cloudflared download was interrupted", { cause: error });
	}
}
async function materializeExecutable(archivePath, temporaryDirectory, artifact) {
	if (artifact.archive === "raw") return archivePath;
	const extractionRoot = join(temporaryDirectory, "extracted");
	await mkdir(extractionRoot);
	try {
		await tar.x({
			cwd: extractionRoot,
			file: archivePath,
			gzip: true,
			preservePaths: false,
			strict: true,
			filter: (path) => path === artifact.executable || path === `./${artifact.executable}`
		});
	} catch (error) {
		throw new CloudflaredDownloadError("invalid-archive", "cloudflared archive extraction failed", { cause: error });
	}
	const extracted = join(extractionRoot, artifact.executable);
	try {
		const file = await lstat(extracted);
		if (!file.isFile() || file.isSymbolicLink()) throw new Error("expected a regular executable file");
	} catch (error) {
		throw new CloudflaredDownloadError("invalid-archive", "cloudflared archive did not contain the expected executable", { cause: error });
	}
	return extracted;
}
async function ensureOnce(options) {
	if (!/^[a-f0-9]{64}$/.test(options.expectedSha256)) throw new CloudflaredDownloadError("checksum-mismatch", "cloudflared checksum must be a lowercase SHA-256 digest");
	const paths = cachePaths(options);
	const cached = await validatedCachedExecutable(options, paths.executable, paths.metadata);
	if (cached !== void 0) return cached;
	await mkdir(paths.directory, { recursive: true });
	const temporaryDirectory = join(paths.directory, `.download-${randomUUID()}`);
	const archivePath = join(temporaryDirectory, "asset");
	await mkdir(temporaryDirectory);
	try {
		await downloadAsset(options, archivePath);
		if (await sha256File(archivePath) !== options.expectedSha256) throw new CloudflaredDownloadError("checksum-mismatch", "cloudflared checksum did not match the pinned release");
		const materialized = await materializeExecutable(archivePath, temporaryDirectory, options.artifact);
		const staged = join(temporaryDirectory, options.artifact.executable);
		if (materialized !== staged) await writeFile(staged, await readFile(materialized), { flag: "wx" });
		if (process.platform !== "win32") await chmod(staged, 448);
		const executableSha256 = await sha256File(staged);
		const backup = join(temporaryDirectory, "previous-executable");
		let movedExisting = false;
		try {
			await rename(paths.executable, backup);
			movedExisting = true;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		try {
			await rename(staged, paths.executable);
		} catch (error) {
			if (movedExisting) await rename(backup, paths.executable);
			throw error;
		}
		const metadata = {
			version: options.version,
			asset: options.artifact.asset,
			archiveSha256: options.expectedSha256,
			executableSha256
		};
		const temporaryMetadata = join(temporaryDirectory, "verified.json");
		await writeFile(temporaryMetadata, `${JSON.stringify(metadata)}\n`, {
			flag: "wx",
			mode: 384
		});
		await rename(temporaryMetadata, paths.metadata);
		return paths.executable;
	} finally {
		await rm(temporaryDirectory, {
			recursive: true,
			force: true
		});
	}
}
/** Download, verify, and cache one exact official cloudflared executable. */
function ensureCloudflared(options) {
	const key = cachePaths(options).executable;
	const existing = inFlight.get(key);
	if (existing !== void 0) return existing;
	const operation = ensureOnce(options).finally(() => {
		inFlight.delete(key);
	});
	inFlight.set(key, operation);
	return operation;
}
//#endregion
//#region lib/types/landing-page.js
/** Render the public, dependency-free QR login exchange page. */
function renderLandingPage(nonce) {
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
<\/script></body></html>`;
}
//#endregion
//#region lib/types/proxy.js
const COOKIE_NAME = "dsh_tunnel_session";
const MAX_LOGIN_BODY_BYTES = 2048;
const HOP_BY_HOP = /* @__PURE__ */ new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade"
]);
function json(response, status, value) {
	const body = JSON.stringify(value);
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
		"content-length": String(Buffer.byteLength(body))
	});
	response.end(body);
}
function unauthorized(response) {
	json(response, 401, { error: "authentication-required" });
}
function cookieValue(request) {
	for (const part of request.headers.cookie?.split(";") ?? []) {
		const separator = part.indexOf("=");
		if (separator === -1) continue;
		if (part.slice(0, separator).trim() === COOKIE_NAME) return part.slice(separator + 1).trim();
	}
}
function withoutAuthCookie(value) {
	const retained = value?.split(";").filter((part) => part.trim().split("=", 1)[0] !== COOKIE_NAME);
	return retained === void 0 || retained.length === 0 ? void 0 : retained.join(";");
}
function targetHeaders(request, targetHost, targetPort) {
	const headers = {};
	const connectionTokens = new Set(request.headers.connection?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean) ?? []);
	for (const [name, value] of Object.entries(request.headers)) {
		if (HOP_BY_HOP.has(name) || connectionTokens.has(name) || name === "host" || name === "origin") continue;
		if (value !== void 0) headers[name] = value;
	}
	const authority = `${targetHost}:${targetPort}`;
	headers.host = authority;
	if (request.headers.origin !== void 0) headers.origin = `http://${authority}`;
	const cookies = withoutAuthCookie(request.headers.cookie);
	if (cookies === void 0) delete headers.cookie;
	else headers.cookie = cookies;
	return headers;
}
function safeResponseHeaders(headers) {
	const result = {};
	for (const [name, value] of Object.entries(headers)) if (!HOP_BY_HOP.has(name) && value !== void 0) result[name] = value;
	return result;
}
async function readLoginToken(request) {
	if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) throw Object.assign(/* @__PURE__ */ new Error("content type"), { status: 400 });
	const declaredLength = Number(request.headers["content-length"]);
	if (Number.isFinite(declaredLength) && declaredLength > MAX_LOGIN_BODY_BYTES) throw Object.assign(/* @__PURE__ */ new Error("body too large"), { status: 413 });
	const chunks = [];
	let length = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		length += buffer.byteLength;
		if (length > MAX_LOGIN_BODY_BYTES) throw Object.assign(/* @__PURE__ */ new Error("body too large"), { status: 413 });
		chunks.push(buffer);
	}
	try {
		const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (typeof value !== "object" || value === null || typeof value.token !== "string") throw new Error("invalid token");
		const token = value.token;
		if (token.length < 32 || token.length > 128) throw new Error("invalid token");
		return token;
	} catch {
		throw Object.assign(/* @__PURE__ */ new Error("invalid json"), { status: 400 });
	}
}
/** Loopback-only authentication and reverse proxy in front of the DSH Web server. */
var AuthenticationProxy = class {
	options;
	server;
	sockets = /* @__PURE__ */ new Set();
	constructor(options) {
		this.options = options;
	}
	/** Bind the proxy and return its OS-assigned loopback port. */
	async start() {
		if (this.server !== void 0) throw new Error("authentication proxy already started");
		const server = createServer((request, response) => {
			this.handle(request, response).catch(() => {
				if (!response.headersSent) json(response, 400, { error: "invalid-request" });
				else response.destroy();
			});
		});
		this.server = server;
		server.on("connection", (socket) => {
			this.sockets.add(socket);
			socket.once("close", () => {
				this.sockets.delete(socket);
			});
		});
		server.on("upgrade", (request, socket, head) => {
			this.handleUpgrade(request, socket, head);
		});
		await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.off("error", reject);
				resolve();
			});
		});
		return server.address().port;
	}
	isAuthenticated(request) {
		const value = cookieValue(request);
		return value !== void 0 && this.options.credentials.validateSession(value, this.options.generation());
	}
	async handle(request, response) {
		const path = new URL(request.url ?? "/", "http://proxy").pathname;
		if (path === "/dsh-qr-login" && request.method === "GET") {
			const nonce = randomBytes(18).toString("base64");
			const body = renderLandingPage(nonce);
			response.writeHead(200, {
				"cache-control": "no-store",
				"content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
				"content-type": "text/html; charset=utf-8",
				"content-length": String(Buffer.byteLength(body)),
				"referrer-policy": "no-referrer",
				"x-content-type-options": "nosniff"
			});
			response.end(body);
			return;
		}
		if (path === "/dsh-qr-login" && request.method === "POST") {
			const source = request.socket.remoteAddress ?? "unknown";
			if (!this.options.limiter.allow(source)) {
				json(response, 429, { error: "rate-limited" });
				return;
			}
			let token;
			try {
				token = await readLoginToken(request);
			} catch (error) {
				json(response, error.status ?? 400, { error: "invalid-request" });
				return;
			}
			const exchange = this.options.credentials.exchangeQrToken(token, this.options.generation());
			if (!exchange.ok) {
				json(response, 401, { error: exchange.code });
				return;
			}
			response.writeHead(204, {
				"cache-control": "no-store",
				"set-cookie": `${COOKIE_NAME}=${exchange.session}; Path=/; Max-Age=${Math.floor(this.options.sessionLifetimeMs / 1e3)}; HttpOnly; Secure; SameSite=Strict`
			});
			response.end();
			return;
		}
		if (path === "/dsh-qr-login") {
			response.writeHead(405, {
				allow: "GET, POST",
				"cache-control": "no-store"
			});
			response.end();
			return;
		}
		if (!this.isAuthenticated(request)) {
			unauthorized(response);
			return;
		}
		this.forwardHttp(request, response);
	}
	forwardHttp(request$1, response) {
		const upstream = request({
			host: this.options.targetHost,
			port: this.options.targetPort,
			method: request$1.method,
			path: request$1.url,
			headers: targetHeaders(request$1, this.options.targetHost, this.options.targetPort)
		}, (upstreamResponse) => {
			response.writeHead(upstreamResponse.statusCode ?? 502, safeResponseHeaders(upstreamResponse.headers));
			upstreamResponse.pipe(response);
		});
		upstream.on("error", () => {
			if (response.headersSent) response.destroy();
			else json(response, 503, { error: "target-unavailable" });
		});
		request$1.pipe(upstream);
	}
	handleUpgrade(request$2, socket, head) {
		if (!this.isAuthenticated(request$2)) {
			socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
			return;
		}
		const headers = targetHeaders(request$2, this.options.targetHost, this.options.targetPort);
		headers.connection = "Upgrade";
		headers.upgrade = request$2.headers.upgrade ?? "websocket";
		const upstreamRequest = request({
			host: this.options.targetHost,
			port: this.options.targetPort,
			method: request$2.method,
			path: request$2.url,
			headers
		});
		upstreamRequest.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
			const responseHeaders = Object.entries(upstreamResponse.headers).filter(([name]) => !HOP_BY_HOP.has(name)).flatMap(([name, value]) => value === void 0 ? [] : [`${name}: ${Array.isArray(value) ? value.join(", ") : value}`]);
			socket.write(`HTTP/1.1 ${upstreamResponse.statusCode ?? 101} Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: ${upstreamResponse.headers.upgrade ?? "websocket"}\r\n${responseHeaders.join("\r\n")}\r\n\r\n`);
			if (upstreamHead.byteLength > 0) socket.write(upstreamHead);
			if (head.byteLength > 0) upstreamSocket.write(head);
			socket.once("close", () => {
				upstreamSocket.destroy();
			});
			upstreamSocket.once("close", () => {
				socket.destroy();
			});
			socket.pipe(upstreamSocket).pipe(socket);
		});
		upstreamRequest.on("response", () => {
			socket.destroy();
		});
		upstreamRequest.on("error", () => {
			socket.destroy();
		});
		upstreamRequest.end();
	}
	/** Stop accepting traffic and destroy every owned HTTP or upgraded socket. */
	async close() {
		const server = this.server;
		if (server === void 0) return;
		this.server = void 0;
		for (const socket of this.sockets) socket.destroy();
		await new Promise((resolve) => {
			server.close(() => {
				resolve();
			});
		});
		this.options.credentials.clear();
	}
};
//#endregion
//#region lib/types/rate-limit.js
function positiveInteger(name, value) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
}
/** Bounded fixed-window limiter for the public QR exchange endpoint. */
var FixedWindowRateLimiter = class {
	options;
	now;
	sources = /* @__PURE__ */ new Map();
	global;
	constructor(options) {
		positiveInteger("perSourceLimit", options.perSourceLimit);
		positiveInteger("globalLimit", options.globalLimit);
		positiveInteger("windowMs", options.windowMs);
		positiveInteger("maxSources", options.maxSources);
		this.options = options;
		this.now = options.now ?? Date.now;
		this.global = {
			startedAt: this.now(),
			count: 0
		};
	}
	/** Consume one attempt when both the source and global windows permit it. */
	allow(source) {
		const now = this.now();
		this.pruneExpired(now);
		this.global = this.currentWindow(this.global, now);
		const sourceWindow = this.currentWindow(this.sources.get(source), now);
		if (sourceWindow.count >= this.options.perSourceLimit || this.global.count >= this.options.globalLimit) return false;
		if (!this.sources.has(source) && this.sources.size >= this.options.maxSources) {
			const oldest = this.sources.keys().next().value;
			if (oldest !== void 0) this.sources.delete(oldest);
		}
		this.sources.delete(source);
		this.sources.set(source, {
			startedAt: sourceWindow.startedAt,
			count: sourceWindow.count + 1
		});
		this.global = {
			startedAt: this.global.startedAt,
			count: this.global.count + 1
		};
		return true;
	}
	/** Number of source windows retained for bounded-memory diagnostics. */
	sourceCount() {
		this.pruneExpired(this.now());
		return this.sources.size;
	}
	currentWindow(record, now) {
		return record === void 0 || now - record.startedAt >= this.options.windowMs ? {
			startedAt: now,
			count: 0
		} : record;
	}
	pruneExpired(now) {
		for (const [source, record] of this.sources) if (now - record.startedAt >= this.options.windowMs) this.sources.delete(source);
	}
};
//#endregion
//#region lib/types/routes.js
function sendJson(response, status, value, headers = {}) {
	const body = JSON.stringify(value);
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
		"content-length": String(Buffer.byteLength(body)),
		...headers
	});
	response.end(body);
}
function methodNotAllowed(response, allow) {
	response.writeHead(405, {
		allow,
		"cache-control": "no-store",
		"content-length": "0"
	});
	response.end();
}
/**
* Register the plugin-owned tunnel status and QR action routes.
* @param webServer - host web server service.
* @param handlers - status and action callbacks owned by the service.
* @returns disposer removing every exact route.
*/
function registerTunnelRoutes(webServer, handlers) {
	const disposers = [
		webServer.register({
			kind: "exact",
			path: "/dsh-tunnel/status",
			handler: async (request, response) => {
				if (request.method !== "GET" && request.method !== "HEAD") {
					methodNotAllowed(response, "GET, HEAD");
					return;
				}
				const body = JSON.stringify({ snapshot: handlers.getSnapshot() });
				response.writeHead(200, {
					"cache-control": "no-store",
					"content-type": "application/json; charset=utf-8",
					"content-length": String(Buffer.byteLength(body))
				});
				response.end(request.method === "HEAD" ? void 0 : body);
			}
		}),
		webServer.register({
			kind: "exact",
			path: "/dsh-tunnel/qr",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					methodNotAllowed(response, "POST");
					return;
				}
				try {
					sendJson(response, 200, await handlers.createQr());
				} catch {
					sendJson(response, 409, { error: "tunnel-not-ready" });
				}
			}
		}),
		webServer.register({
			kind: "exact",
			path: "/dsh-tunnel/restart",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					methodNotAllowed(response, "POST");
					return;
				}
				try {
					await handlers.restart();
					response.writeHead(204, {
						"cache-control": "no-store",
						"content-length": "0"
					});
					response.end();
				} catch {
					sendJson(response, 409, { error: "restart-unavailable" });
				}
			}
		})
	];
	return () => {
		for (const dispose of disposers.reverse()) dispose();
	};
}
//#endregion
//#region lib/types/tunnel-process.js
const execFileAsync = promisify(execFile);
const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com(?![a-z0-9.-])(?:[/?#][^\s]*)?/i;
/** Extract the canonical origin from a Cloudflare Quick Tunnel log line. */
function parseQuickTunnelUrl(line) {
	const match = line.match(QUICK_TUNNEL_URL)?.[0];
	if (match === void 0) return void 0;
	const url = new URL(match);
	return url.protocol === "https:" && /^[a-z0-9-]+\.trycloudflare\.com$/i.test(url.hostname) ? url.origin : void 0;
}
var NodeTunnelProcess = class {
	child;
	exited;
	listeners = /* @__PURE__ */ new Set();
	diagnosticLines = [];
	stopped = false;
	settled = false;
	constructor(child) {
		this.child = child;
		this.exited = new Promise((resolve) => {
			const settle = (value) => {
				if (this.settled) return;
				this.settled = true;
				resolve(value);
			};
			child.once("exit", (code, signal) => {
				settle({
					code,
					signal
				});
			});
			child.once("error", () => {
				settle({
					code: null,
					signal: null
				});
			});
		});
		this.consume(child.stdout);
		this.consume(child.stderr);
	}
	onLine(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	consume(stream) {
		let pending = "";
		stream.setEncoding("utf8");
		stream.on("data", (chunk) => {
			pending += chunk;
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? "";
			for (const line of lines) {
				this.recordDiagnostic(line);
				for (const listener of this.listeners) listener(line);
			}
		});
		stream.once("end", () => {
			if (pending.length === 0) return;
			this.recordDiagnostic(pending);
			for (const listener of this.listeners) listener(pending);
		});
	}
	diagnostics() {
		return [...this.diagnosticLines];
	}
	recordDiagnostic(line) {
		this.diagnosticLines.push(line);
		if (this.diagnosticLines.length > 100) this.diagnosticLines.shift();
	}
	async stop() {
		if (this.stopped || this.settled) return;
		this.stopped = true;
		const pid = this.child.pid;
		if (pid === void 0) {
			this.child.kill("SIGTERM");
			await this.exited;
			return;
		}
		if (process.platform === "win32") try {
			await execFileAsync("taskkill", [
				"/PID",
				String(pid),
				"/T",
				"/F"
			]);
		} catch {}
		else {
			try {
				process.kill(-pid, "SIGTERM");
			} catch {
				this.child.kill("SIGTERM");
			}
			if (!await Promise.race([this.exited.then(() => true), new Promise((resolve) => {
				setTimeout(() => {
					resolve(false);
				}, 2e3);
			})])) try {
				process.kill(-pid, "SIGKILL");
			} catch {
				this.child.kill("SIGKILL");
			}
		}
		await this.exited;
	}
};
/** Spawn the official cloudflared process with updates disabled and a loopback proxy target. */
function spawnTunnelProcess(options) {
	return new NodeTunnelProcess(spawn(options.executable, [
		"tunnel",
		"--no-autoupdate",
		"--url",
		`http://127.0.0.1:${options.proxyPort}`
	], {
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		detached: process.platform !== "win32",
		windowsHide: true
	}));
}
//#endregion
//#region lib/types/tunnel-manager.js
function defaultSleep(milliseconds, signal) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, milliseconds);
		signal.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(signal.reason);
		}, { once: true });
	});
}
/** Owns one Quick Tunnel process at a time and publishes immutable recovery state. */
var TunnelManager = class {
	options;
	spawn;
	sleep;
	now;
	listeners = /* @__PURE__ */ new Set();
	snapshot;
	runId = 0;
	generation = 0;
	current;
	loop;
	abortController;
	started = false;
	disposed = false;
	constructor(options) {
		this.options = options;
		this.spawn = options.spawn ?? spawnTunnelProcess;
		this.sleep = options.sleep ?? defaultSleep;
		this.now = options.now ?? Date.now;
		this.snapshot = Object.freeze({
			status: "starting",
			generation: 0,
			updatedAt: this.now()
		});
	}
	getSnapshot() {
		return this.snapshot;
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** Start recovery and resolve after the first ready or terminal state. */
	start() {
		if (this.started) throw new Error("tunnel manager already started");
		this.started = true;
		return this.beginRun();
	}
	/** Stop the current process and begin a fresh generation immediately. */
	async restart() {
		if (!this.started || this.disposed) throw new Error("tunnel manager is not running");
		this.runId += 1;
		this.abortController?.abort(/* @__PURE__ */ new Error("tunnel restart"));
		await this.current?.stop();
		await this.loop;
		await this.beginRun();
	}
	beginRun() {
		const runId = ++this.runId;
		const controller = new AbortController();
		this.abortController = controller;
		let resolveInitial;
		const initial = new Promise((resolve) => {
			resolveInitial = resolve;
		});
		let initialSettled = false;
		const settleInitial = () => {
			if (initialSettled) return;
			initialSettled = true;
			resolveInitial();
		};
		this.loop = this.runLoop(runId, controller.signal, settleInitial).finally(settleInitial);
		return initial;
	}
	async runLoop(runId, signal, settleInitial) {
		let attempt = 0;
		while (!this.disposed && runId === this.runId) {
			this.publish(attempt === 0 ? {
				status: "starting",
				generation: this.generation,
				updatedAt: this.now()
			} : {
				status: "reconnecting",
				generation: this.generation,
				attempt,
				updatedAt: this.now()
			});
			let process;
			try {
				process = this.spawn({
					executable: this.options.executable,
					proxyPort: this.options.proxyPort
				});
			} catch {
				if (!await this.retry(runId, signal, ++attempt, settleInitial)) return;
				continue;
			}
			this.current = process;
			const outcome = await this.waitForOutcome(process);
			if (this.disposed || runId !== this.runId) return;
			if (outcome.kind === "ready") {
				const readyAt = this.now();
				const retired = this.generation;
				this.generation += 1;
				if (retired > 0) this.options.onGenerationRetired?.(retired);
				this.publish(Object.freeze({
					status: "ready",
					generation: this.generation,
					publicUrl: outcome.publicUrl,
					updatedAt: this.now()
				}));
				settleInitial();
				await process.exited;
				if (this.disposed || runId !== this.runId) return;
				if (this.now() - readyAt >= this.options.startupTimeoutMs) attempt = 0;
			} else if (outcome.kind === "timeout") await process.stop();
			this.current = void 0;
			if (!await this.retry(runId, signal, ++attempt, settleInitial)) return;
		}
	}
	waitForOutcome(process) {
		return new Promise((resolve) => {
			let settled = false;
			let timer;
			let offLine = () => {};
			const finish = (outcome) => {
				if (settled) return;
				settled = true;
				if (timer !== void 0) clearTimeout(timer);
				offLine();
				resolve(outcome);
			};
			offLine = process.onLine((line) => {
				const publicUrl = parseQuickTunnelUrl(line);
				if (publicUrl !== void 0) finish({
					kind: "ready",
					publicUrl
				});
			});
			timer = setTimeout(() => {
				finish({ kind: "timeout" });
			}, this.options.startupTimeoutMs);
			process.exited.then(() => {
				finish({ kind: "exit" });
			});
		});
	}
	async retry(runId, signal, attempt, settleInitial) {
		if (attempt > this.options.restartLimit) {
			this.publish(Object.freeze({
				status: "failed",
				generation: this.generation,
				code: "tunnel-exited",
				message: "公网隧道启动失败",
				retryable: true,
				updatedAt: this.now()
			}));
			settleInitial();
			return false;
		}
		this.publish(Object.freeze({
			status: "reconnecting",
			generation: this.generation,
			attempt,
			updatedAt: this.now()
		}));
		const delay = Math.min(this.options.restartBackoffMaxMs, this.options.restartBackoffMinMs * 2 ** (attempt - 1));
		try {
			await this.sleep(delay, signal);
		} catch {
			return false;
		}
		return !this.disposed && runId === this.runId;
	}
	publish(snapshot) {
		this.snapshot = Object.freeze(snapshot);
		for (const listener of this.listeners) listener();
	}
	/** Cancel recovery and terminate the exact owned process tree. */
	async dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.runId += 1;
		this.abortController?.abort(/* @__PURE__ */ new Error("tunnel manager disposed"));
		await this.current?.stop();
		await this.loop;
		this.current = void 0;
		this.listeners.clear();
	}
};
//#endregion
//#region lib/types/service.js
const QRCodeServer = createRequire(import.meta.url)("qrcode/lib/server.js");
const Config = z.object({
	cloudflaredVersion: z.string().default(DEFAULT_TUNNEL_CONFIG.cloudflaredVersion),
	downloadTimeoutMs: z.natural().min(1).default(DEFAULT_TUNNEL_CONFIG.downloadTimeoutMs),
	tunnelStartupTimeoutMs: z.natural().min(1).default(DEFAULT_TUNNEL_CONFIG.tunnelStartupTimeoutMs),
	qrTokenLifetimeMs: z.natural().min(1).default(DEFAULT_TUNNEL_CONFIG.qrTokenLifetimeMs),
	publicSessionLifetimeMs: z.natural().min(1).default(DEFAULT_TUNNEL_CONFIG.publicSessionLifetimeMs),
	restartLimit: z.natural().default(DEFAULT_TUNNEL_CONFIG.restartLimit),
	restartBackoffMinMs: z.natural().min(1).default(DEFAULT_TUNNEL_CONFIG.restartBackoffMinMs),
	restartBackoffMaxMs: z.natural().min(1).default(DEFAULT_TUNNEL_CONFIG.restartBackoffMaxMs),
	binaryCacheDirectory: z.union([z.string(), z.const(void 0)]).default(void 0)
});
function dshHome() {
	return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}
function defaultCacheDirectory(config) {
	return config.binaryCacheDirectory ?? join(dshHome(), "plugins", "dsh-tunnel-qr-plugin", "cloudflared");
}
function snapshotNow(snapshot) {
	return Object.freeze({
		...snapshot,
		updatedAt: Date.now()
	});
}
/**
* Create one fresh QR response for the currently ready public URL.
* @param publicUrl - current public base URL.
* @param generation - active tunnel generation.
* @param credentials - single-use credential owner.
* @returns QR payload with a fragment-only login token.
*/
async function createQrResponse(publicUrl, generation, credentials) {
	const issued = credentials.issueQrToken(generation);
	const loginUrl = new URL("/dsh-qr-login", publicUrl);
	loginUrl.hash = issued.token;
	const qrDataUrl = await QRCodeServer.toDataURL(loginUrl.href, {
		errorCorrectionLevel: "M",
		margin: 2,
		width: 320
	});
	return {
		generation,
		publicUrl,
		expiresAt: issued.expiresAt,
		loginUrl: loginUrl.href,
		qrDataUrl
	};
}
/** Host service that owns tunnel startup, authenticated proxying, and QR routes. */
var TunnelQrService = class extends Service {
	static inject = ["webServer"];
	static Config = Config;
	snapshot = snapshotNow({
		status: "starting",
		generation: 0
	});
	credentials;
	proxy;
	manager;
	constructor(ctx, config = {}) {
		super(ctx, "tunnelQr");
		this.config = resolveTunnelConfig(config);
	}
	config;
	getSnapshot() {
		return this.manager?.getSnapshot() ?? this.snapshot;
	}
	async createQr() {
		const snapshot = this.getSnapshot();
		if (snapshot.status !== "ready") throw new Error("tunnel is not ready");
		return createQrResponse(snapshot.publicUrl, snapshot.generation, this.credentials);
	}
	async restart() {
		if (this.manager === void 0) throw new Error("restart unavailable");
		await this.manager.restart();
	}
	async [Service.init]() {
		this.credentials = new QrCredentials({
			tokenLifetimeMs: this.config.qrTokenLifetimeMs ?? DEFAULT_TUNNEL_CONFIG.qrTokenLifetimeMs,
			sessionLifetimeMs: this.config.publicSessionLifetimeMs ?? DEFAULT_TUNNEL_CONFIG.publicSessionLifetimeMs
		});
		this.ctx.effect(() => registerTunnelRoutes(this.ctx.webServer, {
			getSnapshot: () => this.getSnapshot(),
			createQr: () => this.createQr(),
			restart: () => this.restart()
		}), "tunnel-qr: routes");
		this.ctx.effect(() => () => this.disposeOwned(), "tunnel-qr: resources");
		await this.initializeRuntime();
	}
	async initializeRuntime() {
		const artifactResolution = resolveArtifact(process.platform, process.arch);
		if (!artifactResolution.ok) {
			this.snapshot = snapshotNow({
				status: "unsupported",
				generation: 0,
				code: "unsupported-platform",
				message: "当前平台暂不支持自动公网隧道。"
			});
			return;
		}
		let executable;
		try {
			executable = await ensureCloudflared({
				version: this.config.cloudflaredVersion,
				artifact: artifactResolution.artifact,
				expectedSha256: artifactResolution.artifact.sha256,
				cacheDirectory: defaultCacheDirectory(this.config),
				downloadTimeoutMs: this.config.downloadTimeoutMs
			});
		} catch (error) {
			if (error instanceof CloudflaredDownloadError) {
				const code = error.code === "checksum-mismatch" ? "checksum-mismatch" : "download-failed";
				this.snapshot = snapshotNow({
					status: "failed",
					generation: 0,
					code,
					message: "公网隧道依赖下载失败。",
					retryable: true
				});
				return;
			}
			this.snapshot = snapshotNow({
				status: "failed",
				generation: 0,
				code: "download-failed",
				message: "公网隧道依赖下载失败。",
				retryable: true
			});
			return;
		}
		const limiter = new FixedWindowRateLimiter({
			perSourceLimit: 10,
			globalLimit: 100,
			windowMs: 6e4,
			maxSources: 1e3
		});
		this.proxy = new AuthenticationProxy({
			targetHost: "127.0.0.1",
			targetPort: this.ctx.webServer.port,
			credentials: this.credentials,
			generation: () => this.manager?.getSnapshot().generation ?? 0,
			limiter,
			sessionLifetimeMs: this.config.publicSessionLifetimeMs
		});
		let proxyPort;
		try {
			proxyPort = await this.proxy.start();
		} catch {
			this.snapshot = snapshotNow({
				status: "failed",
				generation: 0,
				code: "proxy-bind-failed",
				message: "公网隧道入口启动失败。",
				retryable: true
			});
			return;
		}
		this.manager = new TunnelManager({
			executable,
			proxyPort,
			startupTimeoutMs: this.config.tunnelStartupTimeoutMs,
			restartLimit: this.config.restartLimit,
			restartBackoffMinMs: this.config.restartBackoffMinMs,
			restartBackoffMaxMs: this.config.restartBackoffMaxMs,
			onGenerationRetired: (generation) => {
				this.credentials.invalidateGeneration(generation);
			}
		});
		this.manager.start();
	}
	async disposeOwned() {
		await this.manager?.dispose();
		this.manager = void 0;
		await this.proxy?.close();
		this.proxy = void 0;
		this.credentials.clear();
	}
};
//#endregion
export { Config, TunnelQrService, TunnelQrService as default };
