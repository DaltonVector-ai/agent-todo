import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { deriveKeyFromName } from "@agent-todo/core";
import { projectMcpJson } from "../integrations/index.js";
import { remoteKeyForProject, saveRemoteToken } from "../keychain.js";
import { machineDaemonBaseUrl } from "./serve.js";

const MARKER_START = "<!-- agent-todo:start -->";
const MARKER_END = "<!-- agent-todo:end -->";
const ID_LINE =
	"Use the project code to list or create groups, the group id to list or create what is inside a group, and the task id alone to read or update one task.";

export type InitOptions = {
	yes: boolean;
	remote?: string;
	project?: string;
	cwd?: string;
	/** Overrides `AGENT_TODO_DAEMON_URL` and the default loopback URL. */
	baseUrl?: string;
};

export async function runInit(opts: InitOptions): Promise<number> {
	if (opts.remote) {
		return runRemoteInit(opts);
	}

	const cwd = opts.cwd ?? process.cwd();
	const baseUrl = machineDaemonBaseUrl(opts.baseUrl);
	if (!(await machineDaemonListening(baseUrl))) {
		console.error("agent-todo: machine daemon is not running. Run `agent-todo install`.");
		return 1;
	}

	let registration: { code: string; groupId: string };
	try {
		const res = await fetch(`${baseUrl}/api/projects`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: cwd }),
		});
		if (!res.ok) {
			console.error(`agent-todo: init failed: ${res.status} ${await res.text()}`);
			return 1;
		}
		const body = (await res.json()) as { code?: unknown; groupId?: unknown };
		if (typeof body.code !== "string" || typeof body.groupId !== "string") {
			console.error("agent-todo: daemon returned an unexpected project registration.");
			return 1;
		}
		registration = { code: body.code, groupId: body.groupId };
	} catch {
		console.error("agent-todo: machine daemon is not running. Run `agent-todo install`.");
		return 1;
	}

	writeAgentsBlock(cwd, registration.code, registration.groupId);
	console.log(
		`Initialized agent-todo project ${registration.code} (group ${registration.groupId}).`,
	);
	return 0;
}

async function runRemoteInit(opts: InitOptions): Promise<number> {
	const cwd = opts.cwd ?? process.cwd();
	const remote = opts.remote;
	if (!remote) {
		console.error("agent-todo: remote init requires --remote <url>.");
		return 1;
	}
	const remoteUrl = remote.replace(/\/$/, "");
	const projectRef = opts.project ?? `${deriveRepoName(cwd)}/${deriveRepoName(cwd)}`;
	const secret = process.env.AGENT_TODO_BOOTSTRAP_SECRET?.trim();
	if (!secret) {
		console.error(
			"agent-todo: remote init requires AGENT_TODO_BOOTSTRAP_SECRET (set on server and client).",
		);
		return 1;
	}
	const res = await fetch(`${remoteUrl}/api/bootstrap`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-bootstrap-secret": secret,
		},
		body: JSON.stringify({ project: projectRef, name: deriveRepoName(cwd) }),
	});
	if (!res.ok) {
		console.error(`remote init failed: ${res.status} ${await res.text()}`);
		return 1;
	}
	const body = (await res.json()) as { token: string };
	const groupKey = deriveKeyFromName(deriveRepoName(cwd));
	const agentTodoDir = join(cwd, ".agent-todo");
	mkdirSync(agentTodoDir, { recursive: true });
	const configToml = `# .agent-todo/config.toml (committed)
version = 1
mode = "remote"
project = "${projectRef}"
default_group = "${groupKey}"
toolsets = ["core", "plan"]

[remote]
url = "${remoteUrl}"

[limits]
default_max_tokens = 2000
bundle_context_tokens = 1500
`;
	writeFileSync(join(agentTodoDir, "config.toml"), configToml, "utf8");
	saveRemoteToken({
		key: remoteKeyForProject(remoteUrl, projectRef),
		token: body.token,
		url: remoteUrl,
		project: projectRef,
	});
	ensureGitignore(cwd);
	writeFileSync(join(cwd, ".mcp.json"), `${JSON.stringify(projectMcpJson(), null, 2)}\n`, "utf8");
	console.log(`Initialized remote project ${projectRef} at ${remoteUrl}`);
	return 0;
}

function deriveRepoName(cwd: string): string {
	const base = basename(cwd);
	if (base && base !== ".") return base;
	return "project";
}

function writeAgentsBlock(cwd: string, code: string, groupId: string): void {
	const path = join(cwd, "AGENTS.md");
	const block = `${MARKER_START}
Project code: ${code}
Default group: ${groupId}
${ID_LINE}
${MARKER_END}`;
	if (!existsSync(path)) {
		writeFileSync(path, `${block}\n`, "utf8");
		return;
	}
	const text = readFileSync(path, "utf8");
	const start = text.indexOf(MARKER_START);
	const end = text.indexOf(MARKER_END);
	if (start >= 0 && end > start) {
		writeFileSync(
			path,
			`${text.slice(0, start)}${block}${text.slice(end + MARKER_END.length)}`,
			"utf8",
		);
		return;
	}
	const prefix = text.endsWith("\n") ? text : `${text}\n`;
	writeFileSync(path, `${prefix}\n${block}\n`, "utf8");
}

async function machineDaemonListening(baseUrl: string): Promise<boolean> {
	try {
		const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
		return res.ok;
	} catch {
		return false;
	}
}

function ensureGitignore(cwd: string): void {
	const gitignorePath = join(cwd, ".gitignore");
	const lines = [".agent-todo/todo.db", ".agent-todo/todo.db-*", ".agent-todo/*.bak"];
	if (!existsSync(gitignorePath)) {
		writeFileSync(gitignorePath, `${lines.join("\n")}\n`, "utf8");
		return;
	}
	const existing = readFileSync(gitignorePath, "utf8");
	const missing = lines.filter((line) => !existing.includes(line));
	if (missing.length > 0) {
		appendFileSync(gitignorePath, `\n# agent-todo\n${missing.join("\n")}\n`, "utf8");
	}
}
