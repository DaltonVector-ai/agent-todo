import { findBoardAsset } from "./boardAssets.js";

/** GET paths that serve the board SPA shell without Bearer auth (API and MCP stay protected). */
export function isBoardPublicGet(path: string, method: string): boolean {
	if (method !== "GET") return false;
	if (path.startsWith("/api/") || path === "/mcp") return false;
	if (path === "/health" || path === "/ready" || path === "/metrics") return false;
	if (path.startsWith("/.well-known/") || path.startsWith("/oauth/")) return false;
	if (path === "/api/bootstrap") return false;
	if (path === "/" || path.startsWith("/g/")) return true;
	if (findBoardAsset(path)) return true;
	return false;
}
