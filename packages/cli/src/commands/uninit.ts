import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpJson } from "../integrations/mcp-entry.js";
import { MCP_SERVER_ID } from "../integrations/mcp-entry.js";

const MARKER_START = "<!-- agent-todo:start -->";
const MARKER_END = "<!-- agent-todo:end -->";

export type UninitOptions = {
	yes: boolean;
	wipeData?: boolean;
	cwd?: string;
};

export async function runUninit(opts: UninitOptions): Promise<number> {
	const cwd = opts.cwd ?? process.cwd();
	const agentTodoDir = join(cwd, ".agent-todo");

	removeProjectMcpEntry(join(cwd, ".mcp.json"));

	const rulesFile = join(cwd, ".cursor", "rules", "agent-todo.mdc");
	if (existsSync(rulesFile)) {
		unlinkSync(rulesFile);
	}

	for (const file of ["CLAUDE.md", "AGENTS.md"]) {
		stripStub(join(cwd, file));
	}

	if (opts.wipeData && existsSync(agentTodoDir)) {
		rmSync(agentTodoDir, { recursive: true, force: true });
		console.log("Removed .agent-todo (including database).");
	} else if (existsSync(agentTodoDir)) {
		console.log("Left .agent-todo data in place (use --wipe-data to remove).");
	}

	console.log("agent-todo uninit complete.");
	return 0;
}

function removeProjectMcpEntry(path: string): void {
	if (!existsSync(path)) return;
	try {
		const data = JSON.parse(readFileSync(path, "utf8")) as McpJson;
		if (!data.mcpServers?.[MCP_SERVER_ID]) return;
		const servers = { ...data.mcpServers };
		delete servers[MCP_SERVER_ID];
		if (Object.keys(servers).length === 0) {
			unlinkSync(path);
			return;
		}
		writeFileSync(path, `${JSON.stringify({ ...data, mcpServers: servers }, null, 2)}\n`, "utf8");
	} catch {
		/* leave file */
	}
}

function stripStub(path: string): void {
	if (!existsSync(path)) return;
	const text = readFileSync(path, "utf8");
	const start = text.indexOf(MARKER_START);
	const end = text.indexOf(MARKER_END);
	if (start < 0 || end < 0) return;
	const before = text.slice(0, start).trimEnd();
	const after = text.slice(end + MARKER_END.length).trimStart();
	const restored = [before, after].filter(Boolean).join("\n\n");
	if (restored.length === 0) {
		unlinkSync(path);
	} else {
		writeFileSync(path, `${restored}\n`, "utf8");
	}
}
