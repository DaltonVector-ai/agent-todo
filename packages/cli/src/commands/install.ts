import { createConnection } from "node:net";
import {
	MACHINE_LOOPBACK_HOST,
	MACHINE_NETWORK_HOST,
	writeMachineListenHost,
} from "@agent-todo/server";
import {
	disableAutostart,
	enableAutostart,
	removeAutostart,
	spawnDetachedDaemon,
	writeAutostart,
} from "../autostart.js";
import { machineDaemonBaseUrl, machineDaemonPort, machineMcpUrl } from "../daemon/endpoint.js";
import { isThisDaemon, readDaemonHealth } from "../daemon/health.js";
import { runAgentInstall } from "../integrations/index.js";
import { setInstallMcpUrl } from "../integrations/install-context.js";
import { machineClientConfigPath } from "../machine/client.js";
import { applyMachineFlowSelection, resolveInstallFlowChoice } from "../machine/flowSelection.js";
import { machineHttpUrls } from "../machine/networkUrls.js";
import {
	restartMachineDaemon,
	stopMachineDaemonIfRunning,
	waitForMachineDaemon,
} from "../machine/restartDaemon.js";
import { verifyAgentTodoServer } from "../machine/serverUrl.js";
import { type InstallOptions, parseInstallArgs } from "./installArgs.js";
import { promptInstallOptions } from "./installPrompt.js";

type DaemonProbe = "ours" | "foreign" | "down";

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
		const ready = await waitForMachineDaemon(baseUrl, 15_000);
		if (!ready) {
			console.error(`agent-todo install: machine daemon did not become ready at ${baseUrl}`);
			return 1;
		}
	}
	return null;
}

async function stopLocalHostingIfRunning(): Promise<void> {
	const loopbackUrl = machineDaemonBaseUrl();
	const probe = await probeDaemon(loopbackUrl);
	if (probe !== "ours") return;
	stopMachineDaemonIfRunning();
	disableAutostart();
	removeAutostart();
}

async function writeClientFlow(
	parsed: InstallOptions,
	clientUrl: string,
	localServer: boolean,
	interactive: boolean,
): Promise<number | { clientPath: string; flow: string }> {
	const clientPath = machineClientConfigPath();
	const flowChoice = await resolveInstallFlowChoice({
		noFlow: parsed.noFlow,
		interactive,
		clientPath,
	});
	if (typeof flowChoice !== "string") {
		if ("cancelled" in flowChoice) return 1;
		console.error(flowChoice.error);
		return 1;
	}
	applyMachineFlowSelection({
		flow: flowChoice,
		clientUrl,
		localServer,
		clientPath,
	});
	console.log(`client: ${clientPath}`);
	console.log(`flow: ${flowChoice}`);
	return { clientPath, flow: flowChoice };
}

async function runExternalInstall(
	parsed: Extract<InstallOptions, { mode: "external" }>,
	interactive: boolean,
): Promise<number> {
	const baseUrl = parsed.url;
	const ok = await verifyAgentTodoServer(baseUrl);
	if (!ok) {
		console.error(`agent-todo install: ${baseUrl} is not an agent-todo server`);
		return 1;
	}

	await stopLocalHostingIfRunning();

	const flowResult = await writeClientFlow(parsed, baseUrl, false, interactive);
	if (typeof flowResult === "number") return flowResult;

	const mcpUrl = `${baseUrl}/mcp`;
	setInstallMcpUrl(mcpUrl);
	const { exitCode } = runAgentInstall({ agentIds: parsed.agentIds });
	setInstallMcpUrl(undefined);
	return exitCode;
}

async function runLocalInstall(
	parsed: Extract<InstallOptions, { mode: "local" }>,
	interactive: boolean,
): Promise<number> {
	const loopbackUrl = machineDaemonBaseUrl(parsed.serverUrl);
	let port: number;
	try {
		port = machineDaemonPort(loopbackUrl);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}

	const network = !parsed.loopback;
	writeMachineListenHost(network ? MACHINE_NETWORK_HOST : MACHINE_LOOPBACK_HOST);

	const startErr = await ensureHostDaemonRunning(loopbackUrl, { restart: true });
	if (startErr !== null) return startErr;

	const flowResult = await writeClientFlow(parsed, loopbackUrl, true, interactive);
	if (typeof flowResult === "number") return flowResult;

	if (network) {
		for (const url of machineHttpUrls(port)) {
			console.log(`network: ${url}`);
		}
	}

	setInstallMcpUrl(machineMcpUrl(loopbackUrl));

	const autostartPath = writeAutostart();
	if (autostartPath) console.log(`autostart: ${autostartPath}`);
	try {
		enableAutostart();
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
	const { exitCode } = runAgentInstall({ agentIds: parsed.agentIds });
	setInstallMcpUrl(undefined);
	return exitCode;
}

export async function runInstall(flags: string[] = []): Promise<number> {
	let parsed: InstallOptions | { error: string };
	if (flags.length === 0) {
		const prompted = await promptInstallOptions();
		if ("error" in prompted) {
			console.error(prompted.error);
			return 1;
		}
		if ("cancelled" in prompted) return 1;
		parsed = prompted.options;
	} else {
		parsed = parseInstallArgs(flags);
	}

	if ("error" in parsed) {
		console.error(parsed.error);
		return 1;
	}

	const interactive = flags.length === 0;
	if (parsed.mode === "external") {
		return await runExternalInstall(parsed, interactive);
	}
	return await runLocalInstall(parsed, interactive);
}
