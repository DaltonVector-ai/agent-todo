export type DaemonHealth = {
	ok: boolean;
	status: string | null;
	service: string | null;
};

/**
 * One health read for init and `serve --mcp`.
 * Install uses `service` to tell this daemon from another listener.
 */
export async function readDaemonHealth(baseUrl: string): Promise<DaemonHealth | null> {
	try {
		const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
		let status: string | null = null;
		let service: string | null = null;
		try {
			const body = (await res.json()) as { status?: unknown; service?: unknown };
			if (typeof body.status === "string") status = body.status;
			if (typeof body.service === "string") service = body.service;
		} catch {
			/* a non-JSON health body is not this daemon */
		}
		return { ok: res.ok, status, service };
	} catch {
		return null;
	}
}

export function isThisDaemon(health: DaemonHealth | null): boolean {
	return health?.ok === true && health.status === "ok" && health.service === "agent-todo";
}
