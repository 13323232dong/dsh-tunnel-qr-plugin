import z from "@deepseek-ai/schemastery";
//#region lib/types/index.js
/** Services required to publish the plugin-owned QR image. */
const inject = ["webServer"];
/** Required runtime-only credentials; the bundle patch reads them from environment variables. */
const Config = z.object({
	username: z.string().min(1).required(),
	password: z.string().min(1).required()
});
const QR_IMAGE = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAcgAAAHIAQMAAADwb+ipAAAABlBMVEUAAAD///+l2Z/dAAAAAnRSTlP//8i138cAAAAJcEhZcwAACxIAAAsSAdLdfvwAAAKpSURBVHic7ZRLjsMwDEN5/0trgEik5WwG6IpFmTQ/WU9dkDTq0wMhQ4YMGTLkb5Po4/mCrnmbjm5WZ0hnckn7PB4A4AfI3J0hbclZrXaD1AfXpmnNC/kVZOu9TNAAKyG/ieQLoRXmwt0Z0prkHYDasPq5cjpDGpMS/d9zOkM6k+uYhN/57tKrOaQzeVppDlLFa3qBkObk0X6AwvQz7jjxr5D25GkDGGiGWUYYm0xLSF+SykKukOwc8szQv4S0JpvAaL0OLh+jlHwR0pYsftEJp2XSvQsvD4X0I8Ho7q24xMgJXdpOCGlINlEUnInmOK1Od0hzsoob8RSP5ipy495jQ5qSJ9RHarBHC5ihIc3JFnvd9E6qLdE/DQxpS8oJoNzjh+In285eENKYPEaYCZrE7bodsaCQriQ7megV4mtZqQ5pTtbU1UcXrNifHoT0J8XQAn1N6mdCLXuEtCWX3pNd7DRzAvQMaU0uwdsWXD/RXum+PRTSkBzNpXIT0KY9H6qENCfXhClIfxliRz2kM3ntwa177WbO0iOkOzkq91sp4nUSvushrclpKMgJMwbFLKMX5gxpTZY+z9LM0aBOOKeENCZB5Vv6rTroCJwuhDQnuST5T43N9AGNENKXrFomGFTit1MevG4ThHQlJXQXsO2gPD8n3RDSmByRFV7QG3xhztka0prky1qvRXM66nZJSFfyaVN45QXIJNW7tn4hvUmsCeeu6pz6g5DW5CjfO/X6Ai0AOQS3E0I6kjwmuFe66QhAE6tCWpO3xCWkK5iRjPdEO6QveZuCgZY3ajW/9oSQliR1Zrj74hZd2IWQ30PuNI/sPW/A0lJIf3JA1l7o9I45QjqTcwedoCK9wQfTHdKZ1B5cpd251pAZCr6HtCY/OkKGDBkyZMjfJf8A7l5dC3N0j1QAAAAASUVORK5CYII="), (character) => character.charCodeAt(0));
/** Register the plugin-owned QR image route used by the browser half. */
function apply(ctx, config) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-public-qr.png",
		handler: async (request, response) => {
			if (request.method !== "GET" && request.method !== "HEAD") {
				response.writeHead(405, {
					allow: "GET, HEAD",
					"cache-control": "no-store"
				});
				response.end();
				return;
			}
			response.writeHead(200, {
				"cache-control": "no-store",
				"content-length": String(QR_IMAGE.byteLength),
				"content-type": "image/png"
			});
			response.end(request.method === "HEAD" ? void 0 : QR_IMAGE);
		}
	}), "ui-tunnel-qr: image route");
	const accessJson = JSON.stringify({
		username: config.username,
		password: config.password
	});
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-tunnel-access.json",
		handler: (request, response) => {
			if (request.method !== "GET" && request.method !== "HEAD") {
				response.writeHead(405, {
					allow: "GET, HEAD",
					"cache-control": "no-store"
				});
				response.end();
				return;
			}
			response.writeHead(200, {
				"cache-control": "no-store, max-age=0",
				"content-length": String(new TextEncoder().encode(accessJson).byteLength),
				"content-type": "application/json; charset=utf-8",
				expires: "0",
				pragma: "no-cache"
			});
			response.end(request.method === "HEAD" ? void 0 : accessJson);
		}
	}), "ui-tunnel-qr: access route");
}
//#endregion
export { Config, apply, inject };
