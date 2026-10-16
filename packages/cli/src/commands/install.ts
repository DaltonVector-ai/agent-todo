import { createConnection } from "node:net";
import {
	MACHINE_LOOPBACK_HOST,
	MACHINE_NETWORK_HOST,
	writeMachineListenHost,
} from "@agent-todo/server";
import { enableAutostart, spawnDetachedDaemon, writeAutostart } from "../autostart.js";
import { machineDaemonBaseUrl, machineDaemonDbPath, machineDaemonPort } from "../daemon/endpoint.js";
import { isThisDaemon, readDaemonHealth } from "../daemon/health.js";
import { setInstallBearer, setInstallMcpUrl } from "../integrations/install-context.js";
import { runAgentInstall } from "../integrations/index.js";
import { machineMcpUrl } from "../daemon/endpoint.js";
import { writeMachineClient } from "../machine/client.js";
import { ensureHostSuperuser } from "../machine/hostSuperuser.js";
import { machineHttpUrls } from "../machine/networkUrls.js";
import { restartMachineDaemon, waitForMachineDaemon } from "../machine/restartDaemon.js";
import { parseInstallArgs, type InstallOptions } from "./installArgs.js";

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
	return await waitForMachineDaemon(baseUrl, timeoutMs);
}

async function ensureHostDaemonRunning(
	baseUrl: string,
	opts: { restart: boolean },
): Promise<number | null> {
	const probe = await probeDaemon(baseUrl);
	if (probe === "foreign") {
		const port = machineDaemonPort(baseUrl);
		console.error(
			`agent-todo install: 127.0.0.1:${port} is held by another program; agent config and autostart were not changed`,
		);
		return 1;
	}

	if (opts.restart && probe === "ours") {
		try {
			await restartMachineDaemon();
		} catch (err) {
			console.error(err instanceof Error ? err.message : String(err));
			return 1;
		}
		return null;
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
	return null;
}

async function runRemoteInstall(parsed: Extract<InstallOptions, { mode: "remote" }>): Promise<number> {
	const baseUrl = machineDaemonBaseUrl(parsed.url);
	let token: string;
	try {
		const res = await fetch(`${baseUrl}/api/auth/sign-in`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: parsed.username, password: parsed.password }),
		});
		if (!res.ok) {
			console.error(`agent-todo install: sign-in failed (${res.status})`);
			return 1;
		}
		const body = (await res.json()) as { token?: unknown };
		if (typeof body.token !== "string" || !body.token) {
			console.error("agent-todo install: remote server returned an unexpected sign-in response");
			return 1;
		}
		token = body.token;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}

	const clientPath = writeMachineClient({
		url: baseUrl,
		username: parsed.username,
		token,
	});
	console.log(`client: ${clientPath}`);

	const mcpUrl = `${baseUrl}/mcp`;
	setInstallBearer(token);
	setInstallMcpUrl(mcpUrl);
	const { exitCode } = runAgentInstall();
	setInstallBearer(undefined);
	setInstallMcpUrl(undefined);
	return exitCode;
}

async function runHostInstall(parsed: Exclude<InstallOptions, { mode: "remote" }>): Promise<number> {
	const loopbackUrl = machineDaemonBaseUrl(parsed.serverUrl);
	let port: number;
	try {
		port = machineDaemonPort(loopbackUrl);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}

	const network = parsed.mode === "host-network";
	writeMachineListenHost(network ? MACHINE_NETWORK_HOST : MACHINE_LOOPBACK_HOST);

	const startErr = await ensureHostDaemonRunning(loopbackUrl, { restart: network });
	if (startErr !== null) return startErr;

	const dbPath = machineDaemonDbPath();
	let superuser: Awaited<ReturnType<typeof ensureHostSuperuser>>;
	try {
		superuser = await ensureHostSuperuser(dbPath, {
			password: parsed.password,
			requirePassword: network,
		});
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
		url: loopbackUrl,
		username: superuser.username,
		token: superuser.token,
	});
	console.log(`client: ${clientPath}`);

	if (network) {
		for (const url of machineHttpUrls(port)) {
			console.log(`network: ${url}`);
		}
	}

	setInstallBearer(superuser.token);
	setInstallMcpUrl(machineMcpUrl(loopbackUrl));

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
	setInstallMcpUrl(undefined);
	return exitCode;
}

export async function runInstall(flags: string[] = []): Promise<number> {
	const parsed = parseInstallArgs(flags);
	if ("error" in parsed) {
		console.error(parsed.error);
		return 1;
	}

	if (parsed.mode === "remote") {
		return await runRemoteInstall(parsed);
	}
	return await runHostInstall(parsed);
}
