import { createConnection } from "node:net";
import { spawnDetachedDaemon, writeAutostart } from "../autostart.js";
import { machineDaemonBaseUrl, machineDaemonPort } from "../daemon/endpoint.js";
import { runAgentInstall } from "../integrations/index.js";

type DaemonProbe = "ours" | "foreign" | "down";

/**
 * A listener is ours only when this daemon's health check answers.
 * Any other open port is foreign and must not be configured.
 */
async function probeDaemon(baseUrl: string): Promise<DaemonProbe> {
	const url = new URL(baseUrl);
	const port = machineDaemonPort(baseUrl);
	const open = await portAcceptsConnections(url.hostname, port);
	if (!open) return "down";
	try {
		const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
		if (!res.ok) return "foreign";
		const body = (await res.json()) as { status?: unknown };
		return body?.status === "ok" ? "ours" : "foreign";
	} catch {
		return "foreign";
	}
}

function portAcceptsConnections(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host, port });
		const finish = (open: boolean) => {
			socket.removeAllListeners();
			socket.destroy();
			resolve(open);
		};
		socket.setTimeout(400);
		socket.once("connect", () => finish(true));
		socket.once("timeout", () => finish(true));
		socket.once("error", () => finish(false));
	});
}

async function waitUntilOurs(baseUrl: string, timeoutMs: number): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const probe = await probeDaemon(baseUrl);
		if (probe === "ours") return true;
		if (probe === "foreign") return false;
		await Bun.sleep(100);
	}
	return (await probeDaemon(baseUrl)) === "ours";
}

export async function runInstall(): Promise<number> {
	const baseUrl = machineDaemonBaseUrl();
	let port: number;
	try {
		port = machineDaemonPort(baseUrl);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}

	const probe = await probeDaemon(baseUrl);
	if (probe === "foreign") {
		console.error(
			`agent-todo install: 127.0.0.1:${port} is held by another program; agent config and autostart were not changed`,
		);
		return 1;
	}

	if (probe === "down") {
		try {
			spawnDetachedDaemon();
		} catch (err) {
			console.error(err instanceof Error ? err.message : String(err));
			return 1;
		}
		const ready = await waitUntilOurs(baseUrl, 15_000);
		if (!ready) {
			console.error(`agent-todo install: machine daemon did not become ready at ${baseUrl}`);
			return 1;
		}
	}

	const autostartPath = writeAutostart();
	if (autostartPath) console.log(`autostart: ${autostartPath}`);
	const { exitCode } = runAgentInstall();
	return exitCode;
}
