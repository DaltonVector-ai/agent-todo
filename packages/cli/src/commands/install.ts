import { createConnection } from "node:net";
import { enableAutostart, spawnDetachedDaemon, writeAutostart } from "../autostart.js";
import { machineDaemonBaseUrl, machineDaemonDbPath, machineDaemonPort } from "../daemon/endpoint.js";
import { isThisDaemon, readDaemonHealth } from "../daemon/health.js";
import { setInstallBearer } from "../integrations/install-context.js";
import { runAgentInstall } from "../integrations/index.js";
import { writeMachineClient } from "../machine/client.js";
import { ensureHostSuperuser } from "../machine/hostSuperuser.js";
import { parseInstallArgs } from "./installArgs.js";

type DaemonProbe = "ours" | "foreign" | "down";

/**
 * A listener is ours only when /health names agent-todo.
 * Status ok from another program is still foreign and must not be configured.
 */
async function probeDaemon(baseUrl: string): Promise<DaemonProbe> {
	const url = new URL(baseUrl);
	const port = machineDaemonPort(baseUrl);
	const open = await portAcceptsConnections(url.hostname, port);
	if (!open) return "down";
	return isThisDaemon(await readDaemonHealth(baseUrl)) ? "ours" : "foreign";
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

export async function runInstall(flags: string[] = []): Promise<number> {
	const parsed = parseInstallArgs(flags);
	if ("error" in parsed) {
		console.error(parsed.error);
		return 1;
	}

	const baseUrl = machineDaemonBaseUrl(parsed.serverUrl);
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

	const dbPath = machineDaemonDbPath();
	let superuser: Awaited<ReturnType<typeof ensureHostSuperuser>>;
	try {
		superuser = await ensureHostSuperuser(dbPath, { password: parsed.password });
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}

	const username = parsed.username?.trim() || superuser.username;
	if (username !== superuser.username) {
		console.error(`agent-todo install: expected superuser ${superuser.username}, not ${username}`);
		return 1;
	}

	if (superuser.generatedPassword) {
		console.log(`admin password (shown once): ${superuser.generatedPassword}`);
	}

	const clientPath = writeMachineClient({
		url: baseUrl,
		username: superuser.username,
		token: superuser.token,
	});
	console.log(`client: ${clientPath}`);

	setInstallBearer(superuser.token);

	const autostartPath = writeAutostart();
	if (autostartPath) console.log(`autostart: ${autostartPath}`);
	try {
		enableAutostart();
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
	const { exitCode } = runAgentInstall();
	setInstallBearer(undefined);
	return exitCode;
}
