import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ContextService, deriveKeyFromName, GroupService } from "@agent-todo/core";
import { openStore } from "@agent-todo/store-sqlite";
import { projectMcpJson } from "../integrations/index.js";
import { cursorMcpPath } from "../integrations/paths.js";
import { remoteKeyForProject, saveRemoteToken } from "../keychain.js";

const MARKER_START = "<!-- agent-todo:start -->";
const MARKER_END = "<!-- agent-todo:end -->";

export type InitOptions = {
	yes: boolean;
	remote?: string;
	project?: string;
	cwd?: string;
};

export async function runInit(opts: InitOptions): Promise<number> {
	if (opts.remote) {
		return runRemoteInit(opts);
	}

	const cwd = opts.cwd ?? process.cwd();
	const agentTodoDir = join(cwd, ".agent-todo");
	const configPath = join(agentTodoDir, "config.toml");
	const dbPath = join(agentTodoDir, "todo.db");

	if (existsSync(configPath) && !opts.yes) {
		console.error(
			"agent-todo: project already initialized (.agent-todo/config.toml exists). Use --yes to skip prompts or uninit first.",
		);
		return 1;
	}

	if (existsSync(configPath) && opts.yes) {
		console.log("agent-todo: config.toml exists; leaving existing database and config in place.");
		return 0;
	}

	const repoName = deriveRepoName(cwd);
	const groupKey = deriveKeyFromName(repoName);

	mkdirSync(agentTodoDir, { recursive: true });

	const configToml = `# .agent-todo/config.toml (committed)
version = 1
mode = "local"
default_group = "${groupKey}"
toolsets = ["core", "plan"]

[limits]
default_max_tokens = 2000
bundle_context_tokens = 1500
`;
	writeFileSync(configPath, configToml, "utf8");
	ensureGitignore(cwd);

	const store = await openStore({ path: dbPath });
	const groups = new GroupService(store);
	const context = new ContextService(store);

	const existing = await store.groups.getByKey(groupKey);
	if (!existing) {
		await groups.create({
			key: groupKey,
			name: repoName,
			summary: `${repoName} tasks`,
			actor: "init",
		});
	}

	for (const file of ["CLAUDE.md", "AGENTS.md"]) {
		const path = join(cwd, file);
		if (!existsSync(path)) continue;
		const markdown = readFileSync(path, "utf8");
		if (markdown.includes(MARKER_START)) continue;
		await context.importMarkdown(groupKey, markdown, "init");
		writeFileSync(path, buildStub(file, groupKey), "utf8");
	}

	writeFileSync(join(cwd, ".mcp.json"), `${JSON.stringify(projectMcpJson(), null, 2)}\n`, "utf8");

	if (shouldWriteCursorRule()) {
		const rulesDir = join(cwd, ".cursor", "rules");
		mkdirSync(rulesDir, { recursive: true });
		writeFileSync(
			join(rulesDir, "agent-todo.mdc"),
			`---
description: Use agent-todo MCP for tasks and group context
globs: *
---

Load tasks via the agent-todo MCP server (\`task_list\`, \`task_next\`, \`context_get\`). Default group: **${groupKey}**.
`,
			"utf8",
		);
	}

	await store.close();
	console.log(`Initialized agent-todo (group ${groupKey}) at ${agentTodoDir}`);
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

function buildStub(filename: string, groupKey: string): string {
	const label = filename.replace(/\.md$/, "");
	return `${MARKER_START}
# ${label}

Project tasks and context live in agent-todo (group **${groupKey}**).
Use MCP tools \`context_get\` and \`task_next\` / \`task_list\` — not this file — for up-to-date instructions.
${MARKER_END}
`;
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

function shouldWriteCursorRule(): boolean {
	if (process.env.AGENT_TODO_SKIP_CURSOR_RULE === "1") return false;
	try {
		return existsSync(cursorMcpPath()) || existsSync(join(process.cwd(), ".cursor"));
	} catch {
		return false;
	}
}
