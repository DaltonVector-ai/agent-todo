import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVICE = "agent-todo";

function secretsPath(): string {
	const dir = join(homedir(), ".agent-todo");
	mkdirSync(dir, { recursive: true });
	return join(dir, "secrets.json");
}

type SecretFile = Record<string, { token: string; url?: string; project?: string }>;

function readSecrets(): SecretFile {
	try {
		return JSON.parse(readFileSync(secretsPath(), "utf8")) as SecretFile;
	} catch {
		return {};
	}
}

function writeSecrets(data: SecretFile): void {
	writeFileSync(secretsPath(), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

export function saveRemoteToken(input: {
	key: string;
	token: string;
	url: string;
	project: string;
}): void {
	const all = readSecrets();
	all[input.key] = { token: input.token, url: input.url, project: input.project };
	writeSecrets(all);
}

export function loadRemoteToken(
	key: string,
): { token: string; url?: string; project?: string } | null {
	const all = readSecrets();
	return all[key] ?? null;
}

export function remoteKeyForProject(url: string, project: string): string {
	return `${SERVICE}:${new URL(url).host}/${project}`;
}

/** Test override — never commit tokens. */
export function tokenFromEnv(): string | null {
	return process.env.AGENT_TODO_REMOTE_TOKEN?.trim() || null;
}

export function getBearerForProject(url: string, project: string): string | null {
	const fromEnv = tokenFromEnv();
	if (fromEnv) return fromEnv;
	const stored = loadRemoteToken(remoteKeyForProject(url, project));
	return stored?.token ?? null;
}
