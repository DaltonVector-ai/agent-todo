import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const MACHINE_LOOPBACK_HOST = "127.0.0.1";
export const MACHINE_NETWORK_HOST = "0.0.0.0";

export function machineDaemonConfigPath(): string {
	const override = process.env.AGENT_TODO_DAEMON_CONFIG?.trim();
	if (override) return override;
	return join(homedir(), ".agent-todo", "daemon.toml");
}

export function readMachineListenHost(configPath = machineDaemonConfigPath()): string {
	if (!existsSync(configPath)) return MACHINE_LOOPBACK_HOST;
	const text = readFileSync(configPath, "utf8");
	const match = text.match(/^listen_host\s*=\s*"(.*)"\s*$/m);
	if (!match) return MACHINE_LOOPBACK_HOST;
	const host = match[1].trim();
	if (host === MACHINE_NETWORK_HOST || host === MACHINE_LOOPBACK_HOST) return host;
	return MACHINE_LOOPBACK_HOST;
}

export function writeMachineListenHost(
	host: typeof MACHINE_LOOPBACK_HOST | typeof MACHINE_NETWORK_HOST,
	configPath = machineDaemonConfigPath(),
): string {
	mkdirSync(dirname(configPath), { recursive: true });
	const body = `# agent-todo machine daemon
version = 1
listen_host = "${host}"
`;
	writeFileSync(configPath, body, "utf8");
	return configPath;
}
