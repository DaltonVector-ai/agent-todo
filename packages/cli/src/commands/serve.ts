import { existsSync } from "node:fs";
import { createMcpServer } from "@agent-todo/mcp";
import { openStore } from "@agent-todo/store-sqlite";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runStdioMcpProxy } from "../daemon/proxy.js";
import { ensureDaemonRunning } from "../daemon/supervise.js";
import { discoverProject } from "../discover.js";

export async function runServeMcp(): Promise<number> {
	const project = discoverProject();
	if (!project) {
		console.error(
			"agent-todo: no .agent-todo/config.toml found (run `agent-todo init`). " +
				"For tests, set AGENT_TODO_DB to a migrated SQLite path.",
		);
		return 1;
	}

	if (project.mode === "remote") {
		console.error('agent-todo: mode "remote" is not available until phase 7.');
		return 1;
	}

	if (!existsSync(project.dbPath)) {
		console.error(
			`agent-todo: database missing at ${project.dbPath} (run migrate or seed script).`,
		);
		return 1;
	}

	if (project.mode === "daemon") {
		const meta = await ensureDaemonRunning(project);
		return await runStdioMcpProxy(`${meta.baseUrl}/mcp`);
	}

	const store = await openStore({ path: project.dbPath });
	const server = createMcpServer({
		store,
		toolsets: project.toolsets,
		defaultMaxTokens: project.defaultMaxTokens,
	});

	const transport = new StdioServerTransport();
	await server.connect(transport);
	return 0;
}
