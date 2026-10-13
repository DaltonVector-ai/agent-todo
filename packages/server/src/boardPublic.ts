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

/**
 * Board read paths (group list, kanban, task drawer, group context, live stream).
 * Sync, MCP, and bootstrap are not included.
 */
export function isBoardRead(path: string, method: string): boolean {
	if (method !== "GET") return false;
	if (path === "/api/groups" || path === "/api/board" || path === "/api/events/stream") return true;
	if (/^\/api\/groups\/[^/]+\/context$/.test(path)) return true;
	if (/^\/api\/groups\/[^/]+\/tasks\/[^/]+$/.test(path)) return true;
	return false;
}

/**
 * Path check used by the daemon gate.
 * Callers must also require a store and no `resolveContext`.
 */
export function isDaemonBoardRead(path: string, method: string): boolean {
	return isBoardRead(path, method);
}
