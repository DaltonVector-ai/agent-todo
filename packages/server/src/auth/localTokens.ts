/**
 * Optional bearer tokens from AGENT_TODO_TOKENS (`name:token,name:token`).
 * Empty env → localhost-only open access (still bound to 127.0.0.1).
 */
export type LocalToken = { name: string; token: string };

export function parseLocalTokens(raw = process.env.AGENT_TODO_TOKENS): LocalToken[] {
	if (!raw?.trim()) return [];
	return raw
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const colon = part.indexOf(":");
			if (colon < 0) return null;
			const name = part.slice(0, colon).trim();
			const token = part.slice(colon + 1).trim();
			if (!name || !token) return null;
			return { name, token };
		})
		.filter((t): t is LocalToken => t !== null);
}

export function authorizeBearer(
	authHeader: string | undefined,
	tokens: LocalToken[],
): { ok: true; name: string } | { ok: false } {
	if (tokens.length === 0) return { ok: true, name: "localhost" };
	if (!authHeader?.startsWith("Bearer ")) return { ok: false };
	const token = authHeader.slice("Bearer ".length).trim();
	const match = tokens.find((t) => t.token === token);
	if (!match) return { ok: false };
	return { ok: true, name: match.name };
}

const LOCAL_ORIGIN_PREFIXES = ["http://127.0.0.1:", "http://localhost:"];

export function isAllowedBrowserOrigin(origin: string | undefined): boolean {
	if (!origin) return true;
	return LOCAL_ORIGIN_PREFIXES.some((p) => origin.startsWith(p));
}
