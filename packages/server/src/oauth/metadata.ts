import { randomUUID } from "node:crypto";
import type { createApp } from "../createApp.js";

export function mountOAuthMetadata(app: ReturnType<typeof createApp>, publicUrl: string): void {
	const base = publicUrl.replace(/\/$/, "");
	app.get("/.well-known/oauth-authorization-server", (c) => {
		return c.json({
			issuer: base,
			authorization_endpoint: `${base}/oauth/authorize`,
			token_endpoint: `${base}/oauth/token`,
			registration_endpoint: `${base}/oauth/register`,
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code", "urn:ietf:params:oauth:grant-type:device_code"],
			code_challenge_methods_supported: ["S256"],
		});
	});

	app.post("/oauth/register", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		const clientId = `client_${randomUUID()}`;
		return c.json({
			client_id: clientId,
			client_name: body.client_name ?? "mcp-client",
			redirect_uris: body.redirect_uris ?? [`${base}/oauth/callback`],
			grant_types: ["authorization_code", "urn:ietf:params:oauth:grant-type:device_code"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		});
	});

	app.post("/oauth/device_authorization", (c) => {
		return c.json({
			device_code: `device_${randomUUID()}`,
			user_code: "ABCD-1234",
			verification_uri: `${base}/oauth/device`,
			expires_in: 600,
			interval: 5,
		});
	});

	app.post("/oauth/token", (c) => {
		return c.text("device login completes via API token in v1 self-host", 501);
	});
}
