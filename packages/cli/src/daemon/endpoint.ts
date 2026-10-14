import { MACHINE_DAEMON_HOST, MACHINE_DAEMON_PORT, machineDatabasePath } from "@agent-todo/server";

/** Base URL of the machine daemon. Tests override with `AGENT_TODO_DAEMON_URL`. */
export function machineDaemonBaseUrl(override?: string): string {
	const raw = override?.trim() || process.env.AGENT_TODO_DAEMON_URL?.trim();
	if (raw) return raw.replace(/\/$/, "");
	return `http://${MACHINE_DAEMON_HOST}:${MACHINE_DAEMON_PORT}`;
}

export function machineMcpUrl(baseUrl = machineDaemonBaseUrl()): string {
	return `${baseUrl}/mcp`;
}

export function machineDaemonPort(baseUrl = machineDaemonBaseUrl()): number {
	const url = new URL(baseUrl);
	const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(`invalid machine daemon URL: ${baseUrl}`);
	}
	return port;
}

/** SQLite path for the machine daemon. Tests override with `AGENT_TODO_DB`. */
export function machineDaemonDbPath(override?: string): string {
	const raw = override?.trim() || process.env.AGENT_TODO_DB?.trim();
	return machineDatabasePath(raw);
}
