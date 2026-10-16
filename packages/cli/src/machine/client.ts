import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type MachineClientRecord = {
	url: string;
	username: string;
	token: string;
};

export function machineClientConfigPath(): string {
	const override = process.env.AGENT_TODO_MACHINE_CLIENT?.trim();
	if (override) return override;
	return join(homedir(), ".agent-todo", "client.toml");
}

function escapeTomlString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function writeMachineClient(record: MachineClientRecord, pathOverride?: string): string {
	const path = pathOverride ?? machineClientConfigPath();
	mkdirSync(dirname(path), { recursive: true });
	const body = `# agent-todo machine client (outside the repo)
version = 1
url = "${escapeTomlString(record.url)}"
username = "${escapeTomlString(record.username)}"
token = "${escapeTomlString(record.token)}"
`;
	writeFileSync(path, body, { mode: 0o600 });
	return path;
}

export function readMachineClient(path = machineClientConfigPath()): MachineClientRecord | null {
	try {
		const text = readFileSync(path, "utf8");
		const url = readTomlString(text, "url");
		const username = readTomlString(text, "username");
		const token = readTomlString(text, "token");
		if (!url || !username || !token) return null;
		return { url, username, token };
	} catch {
		return null;
	}
}

function readTomlString(text: string, key: string): string | null {
	const match = text.match(new RegExp(`^${key}\\s*=\\s*"(.*)"\\s*$`, "m"));
	if (!match) return null;
	return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}
