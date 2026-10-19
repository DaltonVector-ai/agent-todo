import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const MACHINE_LOOPBACK_HOST = "127.0.0.1";
export const MACHINE_NETWORK_HOST = "0.0.0.0";

export type DaemonToml = {
	listenHost: string;
	/** Undefined when the key is absent (server default is built-in flow). */
	flow?: string;
};

export function machineDaemonConfigPath(): string {
	const override = process.env.AGENT_TODO_DAEMON_CONFIG?.trim();
	if (override) return override;
	return join(homedir(), ".agent-todo", "daemon.toml");
}

function readTomlString(text: string, key: string): string | undefined {
	const match = text.match(new RegExp(`^${key}\\s*=\\s*"(.*)"\\s*$`, "m"));
	if (!match) return undefined;
	return (match[1] ?? "").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function escapeTomlString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function readDaemonToml(configPath = machineDaemonConfigPath()): DaemonToml {
	if (!existsSync(configPath)) {
		return { listenHost: MACHINE_LOOPBACK_HOST };
	}
	const text = readFileSync(configPath, "utf8");
	const listenHost = readTomlString(text, "listen_host") ?? MACHINE_LOOPBACK_HOST;
	const flow = readTomlString(text, "flow");
	return flow !== undefined ? { listenHost, flow } : { listenHost };
}

export function writeDaemonToml(
	patch: { listenHost?: string; flow?: string },
	configPath = machineDaemonConfigPath(),
): string {
	const current = readDaemonToml(configPath);
	const listenHost = patch.listenHost ?? current.listenHost;
	const flow = patch.flow !== undefined ? patch.flow : current.flow;
	mkdirSync(dirname(configPath), { recursive: true });
	const lines = [
		"# agent-todo machine daemon",
		"version = 1",
		`listen_host = "${escapeTomlString(listenHost)}"`,
	];
	if (flow !== undefined) {
		lines.push(`flow = "${escapeTomlString(flow)}"`);
	}
	writeFileSync(configPath, `${lines.join("\n")}\n`, "utf8");
	return configPath;
}

export function readMachineListenHost(configPath = machineDaemonConfigPath()): string {
	const host = readDaemonToml(configPath).listenHost;
	if (host === MACHINE_NETWORK_HOST || host === MACHINE_LOOPBACK_HOST) return host;
	return MACHINE_LOOPBACK_HOST;
}

export function writeMachineListenHost(
	host: typeof MACHINE_LOOPBACK_HOST | typeof MACHINE_NETWORK_HOST,
	configPath = machineDaemonConfigPath(),
): string {
	return writeDaemonToml({ listenHost: host }, configPath);
}

export function readMachineDaemonFlow(configPath = machineDaemonConfigPath()): string | undefined {
	return readDaemonToml(configPath).flow;
}

export function writeMachineDaemonFlow(
	flow: string,
	configPath = machineDaemonConfigPath(),
): string {
	return writeDaemonToml({ flow }, configPath);
}
