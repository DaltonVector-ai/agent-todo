import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type MachineClientRecord = {
	url: string;
	/** When unset in the file, install treats flow as unset. */
	flow?: string;
};

export function machineClientConfigPath(): string {
	const override = process.env.AGENT_TODO_MACHINE_CLIENT?.trim();
	if (override) return override;
	return join(homedir(), ".agent-todo", "client.toml");
}

function escapeTomlString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function readTomlString(text: string, key: string): string | null {
	const match = text.match(new RegExp(`^${key}\\s*=\\s*"(.*)"\\s*$`, "m"));
	if (!match) return null;
	return (match[1] ?? "").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export function writeMachineClient(record: MachineClientRecord, pathOverride?: string): string {
	const path = pathOverride ?? machineClientConfigPath();
	mkdirSync(dirname(path), { recursive: true });
	const lines = [
		"# agent-todo machine client (outside the repo)",
		"version = 1",
		`url = "${escapeTomlString(record.url)}"`,
	];
	if (record.flow !== undefined) {
		lines.push(`flow = "${escapeTomlString(record.flow)}"`);
	}
	writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
	return path;
}

export function readMachineClient(path = machineClientConfigPath()): MachineClientRecord | null {
	try {
		const text = readFileSync(path, "utf8");
		const url = readTomlString(text, "url");
		if (!url) return null;
		const flow = readTomlString(text, "flow");
		return flow !== null ? { url, flow } : { url };
	} catch {
		return null;
	}
}

export function readMachineClientFlow(path = machineClientConfigPath()): string | undefined {
	return readMachineClient(path)?.flow;
}

export function writeMachineClientFlow(
	flow: string,
	path = machineClientConfigPath(),
): string | null {
	const current = readMachineClient(path);
	if (!current) return null;
	return writeMachineClient({ ...current, flow }, path);
}
