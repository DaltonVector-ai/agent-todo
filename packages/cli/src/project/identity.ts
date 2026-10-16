import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKER_START = "<!-- agent-todo:start -->";
const MARKER_END = "<!-- agent-todo:end -->";

export type RepoProjectIdentity = {
	code: string | null;
	defaultGroup: string | null;
};

export function readAgentsIdentityFile(path: string): RepoProjectIdentity {
	return readAgentsIdentity(path);
}

export function readConfigIdentityFile(path: string): RepoProjectIdentity {
	return readConfigIdentity(path);
}

export function reconcileRepoIdentity(
	agents: RepoProjectIdentity,
	config: RepoProjectIdentity,
): RepoProjectIdentity | { error: string } {
	const codes = [agents.code, config.code].filter(Boolean) as string[];
	const groups = [agents.defaultGroup, config.defaultGroup].filter(Boolean) as string[];
	if (codes.length === 2 && codes[0] !== codes[1]) {
		return { error: "agent-todo: project code in AGENTS.md and config.toml disagree" };
	}
	if (groups.length === 2 && groups[0] !== groups[1]) {
		return { error: "agent-todo: default group in AGENTS.md and config.toml disagree" };
	}
	const code = codes[0] ?? null;
	const defaultGroup = groups[0] ?? (code ? `${code}-1` : null);
	return { code, defaultGroup };
}

export function writeMachineProjectConfig(
	cwd: string,
	input: { code: string; defaultGroup: string },
): void {
	const dir = join(cwd, ".agent-todo");
	mkdirSync(dir, { recursive: true });
	const body = `# .agent-todo/config.toml (committed)
version = 1
project = "${input.code}"
default_group = "${input.defaultGroup}"
`;
	writeFileSync(join(dir, "config.toml"), body, "utf8");
}

function readAgentsIdentity(path: string): RepoProjectIdentity {
	if (!existsSync(path)) return { code: null, defaultGroup: null };
	const text = readFileSync(path, "utf8");
	const start = text.indexOf(MARKER_START);
	const end = text.indexOf(MARKER_END);
	if (start < 0 || end <= start) return { code: null, defaultGroup: null };
	const block = text.slice(start, end);
	const code = readLineValue(block, "Project code:");
	const defaultGroup = readLineValue(block, "Default group:");
	return { code, defaultGroup };
}

function readConfigIdentity(path: string): RepoProjectIdentity {
	if (!existsSync(path)) return { code: null, defaultGroup: null };
	const text = readFileSync(path, "utf8");
	const project = readTomlString(text, "project");
	const defaultGroup = readTomlString(text, "default_group");
	return { code: project, defaultGroup };
}

function readLineValue(block: string, label: string): string | null {
	const line = block
		.split("\n")
		.map((row) => row.trim())
		.find((row) => row.startsWith(label));
	if (!line) return null;
	const value = line.slice(label.length).trim();
	return value || null;
}

function readTomlString(text: string, key: string): string | null {
	const match = text.match(new RegExp(`^${key}\\s*=\\s*"(.*)"\\s*$`, "m"));
	if (!match) return null;
	return (match[1] ?? "").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}
