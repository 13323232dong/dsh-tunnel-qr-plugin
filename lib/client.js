window.__ModuleLoader__.load({
	id: "dsh-tunnel-qr-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region lib/types/client/api.js
		const STATUS_PATH = "/dsh-tunnel/status";
		const QR_PATH = "/dsh-tunnel/qr";
		const RESTART_PATH = "/dsh-tunnel/restart";
		function createTunnelClientApi(fetcher = globalThis.fetch.bind(globalThis)) {
			return {
				async readStatus(signal) {
					return parseStatusResponse(await requestJson(fetcher, STATUS_PATH, {
						method: "GET",
						signal
					}));
				},
				async readFreshQr(signal) {
					return parseQrResponse(await requestJson(fetcher, QR_PATH, {
						method: "POST",
						signal
					}));
				},
				async restart(signal) {
					const response = await fetcher(RESTART_PATH, {
						method: "POST",
						signal
					});
					if (!response.ok) throw new Error(`tunnel restart failed: HTTP ${response.status}`);
				}
			};
		}
		async function requestJson(fetcher, input, init) {
			const response = await fetcher(input, {
				...init,
				headers: {
					accept: "application/json",
					...init.headers ?? {}
				}
			});
			if (!response.ok) throw new Error(`request failed: HTTP ${response.status}`);
			return await response.json();
		}
		function parseStatusResponse(value) {
			if (!isRecord(value) || !("snapshot" in value)) throw new Error("invalid tunnel status response");
			return { snapshot: parseTunnelSnapshot(value.snapshot) };
		}
		function parseQrResponse(value) {
			if (!isRecord(value) || typeof value.generation !== "number" || !Number.isSafeInteger(value.generation) || typeof value.publicUrl !== "string" || !isHttpUrl(value.publicUrl) || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt) || typeof value.qrDataUrl !== "string" || !value.qrDataUrl.startsWith("data:image/")) throw new Error("invalid tunnel qr response");
			return {
				generation: value.generation,
				publicUrl: value.publicUrl,
				expiresAt: value.expiresAt,
				qrDataUrl: value.qrDataUrl
			};
		}
		function parseTunnelSnapshot(value) {
			if (!isRecord(value) || typeof value.status !== "string" || typeof value.generation !== "number" || !Number.isSafeInteger(value.generation) || typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) throw new Error("invalid tunnel status snapshot");
			switch (value.status) {
				case "starting": return {
					status: "starting",
					generation: value.generation,
					updatedAt: value.updatedAt
				};
				case "ready":
					if (typeof value.publicUrl !== "string" || !isHttpUrl(value.publicUrl)) throw new Error("invalid tunnel status snapshot");
					return {
						status: "ready",
						generation: value.generation,
						updatedAt: value.updatedAt,
						publicUrl: value.publicUrl
					};
				case "reconnecting":
					if (typeof value.attempt !== "number" || !Number.isSafeInteger(value.attempt)) throw new Error("invalid tunnel status snapshot");
					return {
						status: "reconnecting",
						generation: value.generation,
						updatedAt: value.updatedAt,
						attempt: value.attempt
					};
				case "failed":
					if (typeof value.code !== "string" || typeof value.message !== "string" || typeof value.retryable !== "boolean") throw new Error("invalid tunnel status snapshot");
					return {
						status: "failed",
						generation: value.generation,
						updatedAt: value.updatedAt,
						code: value.code,
						message: value.message,
						retryable: value.retryable
					};
				case "unsupported":
					if (value.code !== "unsupported-platform" || typeof value.message !== "string") throw new Error("invalid tunnel status snapshot");
					return {
						status: "unsupported",
						generation: value.generation,
						updatedAt: value.updatedAt,
						code: value.code,
						message: value.message
					};
				default: throw new Error("invalid tunnel status snapshot");
			}
		}
		function isRecord(value) {
			return typeof value === "object" && value !== null;
		}
		function isHttpUrl(value) {
			try {
				const url = new URL(value);
				return url.protocol === "http:" || url.protocol === "https:";
			} catch {
				return false;
			}
		}
		//#endregion
		//#region lib/types/client/TunnelQrOverlay.js
		const buttonStyle = {
			position: "fixed",
			right: "16px",
			bottom: "18px",
			zIndex: 1e3,
			display: "inline-flex",
			alignItems: "center",
			gap: "6px",
			minHeight: "34px",
			padding: "6px 11px",
			border: "1px solid rgba(0,0,0,0.14)",
			borderRadius: "7px",
			background: "rgba(255,255,255,0.92)",
			color: "#111",
			boxShadow: "0 2px 9px rgba(0,0,0,0.12)",
			cursor: "pointer",
			font: "inherit",
			fontSize: "13px",
			lineHeight: "1",
			pointerEvents: "auto"
		};
		const frameStyle = {
			position: "fixed",
			inset: 0,
			zIndex: 1100,
			display: "grid",
			placeItems: "center",
			padding: "12px",
			pointerEvents: "none"
		};
		const backdropStyle = {
			position: "absolute",
			inset: 0,
			background: "rgba(0,0,0,0.48)",
			pointerEvents: "auto"
		};
		const panelStyle = {
			position: "relative",
			boxSizing: "border-box",
			width: "min(360px, calc(100vw - 24px))",
			maxWidth: "100%",
			maxHeight: "min(640px, calc(100vh - 24px))",
			overflow: "auto",
			padding: "18px",
			border: "1px solid rgba(0,0,0,0.12)",
			borderRadius: "8px",
			background: "#fff",
			color: "#111",
			boxShadow: "0 16px 48px rgba(0,0,0,0.28)",
			pointerEvents: "auto"
		};
		const controlRowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: "8px",
			marginTop: "12px"
		};
		const iconButtonStyle = {
			border: "1px solid rgba(0,0,0,0.16)",
			borderRadius: "6px",
			background: "transparent",
			color: "inherit",
			padding: "6px 10px",
			cursor: "pointer",
			font: "inherit"
		};
		const qrStyle = {
			display: "block",
			width: "min(300px, 100%)",
			aspectRatio: "1 / 1",
			margin: "0 auto",
			objectFit: "contain"
		};
		function createTunnelQrOverlayComponent(controller) {
			return function TunnelQrOverlayComponent() {
				return buildTunnelQrOverlayView((0, react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot), {
					open: (target) => {
						controller.open(target ?? void 0);
					},
					close: () => {
						controller.close();
					},
					refresh: () => {
						controller.refresh();
					},
					restart: () => {
						controller.restart();
					},
					copyUrl: () => {
						controller.copyUrl();
					},
					handleKeyDown: (event) => {
						controller.handleKeyDown(event);
					},
					handleBackdrop: () => {
						controller.handleBackdrop();
					}
				});
			};
		}
		function buildTunnelQrOverlayView(snapshot, handlers) {
			const publicUrl = snapshot.qr?.publicUrl ?? (snapshot.status?.status === "ready" ? snapshot.status.publicUrl : null);
			return react.default.createElement(react.default.Fragment, null, react.default.createElement("button", {
				type: "button",
				"aria-label": "公网访问二维码",
				title: "公网访问二维码",
				style: buttonStyle,
				onClick: (event) => {
					handlers.open(event.currentTarget);
				}
			}, react.default.createElement("span", {
				"aria-hidden": "true",
				style: { fontSize: "18px" }
			}, "▦"), react.default.createElement("span", null, "二维码")), !snapshot.open ? null : react.default.createElement("div", {
				role: "dialog",
				"aria-modal": "true",
				"aria-label": "公网访问二维码",
				style: frameStyle,
				onKeyDown: (event) => {
					handlers.handleKeyDown(event);
				}
			}, react.default.createElement("div", {
				style: backdropStyle,
				onClick: () => {
					handlers.handleBackdrop();
				}
			}), react.default.createElement("section", { style: panelStyle }, react.default.createElement("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				gap: "12px",
				alignItems: "center"
			} }, react.default.createElement("h2", { style: {
				margin: 0,
				fontSize: "16px"
			} }, "公网访问二维码"), react.default.createElement("button", {
				type: "button",
				title: "关闭",
				"aria-label": "关闭二维码",
				autoFocus: true,
				style: {
					...iconButtonStyle,
					fontSize: "18px",
					padding: "2px 8px"
				},
				onClick: () => {
					handlers.close();
				}
			}, "×")), react.default.createElement("p", { style: {
				margin: "12px 0 0",
				fontSize: "12px",
				color: "#555",
				minHeight: "18px"
			} }, describeStatus(snapshot)), publicUrl === null || snapshot.qr === null ? react.default.createElement("div", { style: {
				display: "grid",
				placeItems: "center",
				width: "min(300px, 100%)",
				aspectRatio: "1 / 1",
				margin: "12px auto 0",
				borderRadius: "8px",
				background: "#f3f4f6",
				color: "#555",
				textAlign: "center",
				padding: "18px"
			} }, snapshot.error ?? "二维码生成后会显示在这里。") : react.default.createElement("img", {
				src: snapshot.qr.qrDataUrl,
				alt: "DSH 公网访问二维码",
				style: qrStyle
			}), react.default.createElement("div", { style: {
				marginTop: "12px",
				fontSize: "12px",
				color: "#333",
				overflowWrap: "anywhere"
			} }, publicUrl ?? "等待公网地址…"), snapshot.error === null ? null : react.default.createElement("div", {
				role: "status",
				style: {
					marginTop: "10px",
					color: "#b91c1c",
					fontSize: "12px"
				}
			}, snapshot.error), react.default.createElement("div", { style: controlRowStyle }, react.default.createElement("button", {
				type: "button",
				title: "复制公网地址",
				"aria-label": "复制公网地址",
				style: iconButtonStyle,
				disabled: publicUrl === null,
				onClick: () => {
					handlers.copyUrl();
				}
			}, snapshot.copyState === "copied" ? "已复制" : snapshot.copyState === "failed" ? "复制失败" : "复制"), react.default.createElement("div", { style: {
				display: "flex",
				gap: "8px"
			} }, react.default.createElement("button", {
				type: "button",
				title: "刷新二维码",
				"aria-label": "刷新二维码",
				style: iconButtonStyle,
				disabled: snapshot.busy !== "idle",
				onClick: () => {
					handlers.refresh();
				}
			}, snapshot.busy === "refreshing" ? "刷新中" : "刷新"), react.default.createElement("button", {
				type: "button",
				title: "重启内网穿透",
				"aria-label": "重启内网穿透",
				style: iconButtonStyle,
				disabled: snapshot.busy !== "idle",
				onClick: () => {
					handlers.restart();
				}
			}, snapshot.busy === "restarting" ? "重启中" : "重启"))))));
		}
		function describeStatus(snapshot) {
			const status = snapshot.status;
			if (status === null) return snapshot.busy === "refreshing" ? "正在读取公网状态…" : "等待公网状态…";
			switch (status.status) {
				case "starting": return "正在启动内网穿透。";
				case "ready": return "公网地址可用，扫描二维码即可访问。";
				case "reconnecting": return `正在重连公网地址（第 ${status.attempt} 次）。`;
				case "failed": return `${status.message}${status.retryable ? " 可尝试刷新或重启。" : ""}`;
				case "unsupported": return status.message;
				default: return "等待公网状态…";
			}
		}
		//#endregion
		//#region lib/types/client/store.js
		const DEFAULT_POLL_MS = 15e3;
		var TunnelQrController = class {
			api;
			snapshot = {
				open: false,
				busy: "idle",
				status: null,
				qr: null,
				error: null,
				copyState: "idle"
			};
			listeners = /* @__PURE__ */ new Set();
			pollMs;
			pollHandle = null;
			inFlight = null;
			activeAbort = null;
			disposed = false;
			restoreFocus = null;
			constructor(api, options = {}) {
				this.api = api;
				this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
			}
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			getSnapshot = () => this.snapshot;
			async open(target) {
				if (target !== void 0) this.restoreFocus = target;
				if (!this.snapshot.open) this.publish({
					...this.snapshot,
					open: true,
					copyState: "idle"
				});
				await this.refresh();
			}
			close() {
				if (!this.snapshot.open) return;
				this.clearPoll();
				this.publish({
					...this.snapshot,
					open: false,
					busy: "idle",
					copyState: "idle"
				});
				this.restoreFocus?.focus();
			}
			handleBackdrop = () => {
				this.close();
			};
			handleKeyDown = (event) => {
				if (event.key === "Escape") this.close();
			};
			async refresh() {
				await this.runExclusive("refreshing", async (signal) => {
					const nextStatus = await this.api.readStatus(signal);
					const nextQr = nextStatus.snapshot.status === "ready" ? await this.api.readFreshQr(signal) : null;
					if (signal.aborted || this.disposed) return;
					this.publish({
						...this.snapshot,
						busy: "idle",
						error: null,
						open: true,
						status: nextStatus.snapshot,
						qr: nextQr
					});
					this.schedulePoll();
				});
			}
			async restart() {
				await this.runExclusive("restarting", async (signal) => {
					await this.api.restart(signal);
					if (signal.aborted || this.disposed) return;
					this.publish({
						...this.snapshot,
						busy: "restarting",
						copyState: "idle",
						qr: null,
						error: null
					});
					const nextStatus = await this.api.readStatus(signal);
					if (signal.aborted || this.disposed) return;
					this.publish({
						...this.snapshot,
						busy: "idle",
						status: nextStatus.snapshot,
						error: null
					});
					this.schedulePoll();
				});
			}
			async copyUrl() {
				const url = this.snapshot.qr?.publicUrl ?? (this.snapshot.status?.status === "ready" ? this.snapshot.status.publicUrl : null);
				if (typeof url !== "string") return;
				try {
					await globalThis.navigator?.clipboard?.writeText(url);
					this.publish({
						...this.snapshot,
						copyState: "copied"
					});
				} catch {
					this.publish({
						...this.snapshot,
						copyState: "failed"
					});
				}
			}
			dispose() {
				this.disposed = true;
				this.clearPoll();
				this.activeAbort?.abort();
				this.listeners.clear();
			}
			async runExclusive(busy, work) {
				if (this.inFlight !== null) return this.inFlight;
				const controller = new AbortController();
				this.activeAbort = controller;
				this.publish({
					...this.snapshot,
					busy,
					error: null
				});
				const task = work(controller.signal).catch((error) => {
					if (controller.signal.aborted || this.disposed) return;
					const message = error instanceof Error ? error.message : "Tunnel request failed";
					this.publish({
						...this.snapshot,
						busy: "idle",
						error: message
					});
				}).finally(() => {
					if (this.inFlight === task) this.inFlight = null;
					if (this.activeAbort === controller) this.activeAbort = null;
					if (!this.disposed) {
						this.publish({
							...this.snapshot,
							busy: "idle"
						});
						this.schedulePoll();
					}
				});
				this.inFlight = task;
				return task;
			}
			schedulePoll() {
				this.clearPoll();
				if (!this.snapshot.open || this.disposed) return;
				this.pollHandle = setTimeout(() => {
					this.pollHandle = null;
					if (this.inFlight === null) this.refresh();
				}, this.pollMs);
			}
			clearPoll() {
				if (this.pollHandle !== null) clearTimeout(this.pollHandle);
				this.pollHandle = null;
			}
			publish(next) {
				this.snapshot = next;
				for (const listener of [...this.listeners]) listener();
			}
		};
		//#endregion
		//#region lib/types/client/index.js
		const inject = ["slots"];
		function apply(ctx) {
			const controller = new TunnelQrController(createTunnelClientApi());
			const component = createTunnelQrOverlayComponent(controller);
			const unregister = ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "tunnel-qr",
				order: 100
			}, component));
			ctx.effect(() => () => {
				unregister();
				controller.dispose();
			}, "tunnel-qr client overlay");
			controller.open();
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map