import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMachineDaemon } from "../../packages/server/src/index.ts";
import { readMachineClient } from "../../packages/cli/src/machine/client.ts";
import { migrateMachineDb, seedMachineSuperuser, TEST_ADMIN_PASSWORD } from "./machineAuth.ts";

const cliEntry = join(import.meta.dir, "../../packages/cli/src/index.ts");

describe("remote install", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("signs in and writes remote MCP URL without starting a local database", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-todo-remote-"));
		const project = join(home, "project");
		mkdirSync(join(project, ".cursor"), { recursive: true });
		const serverDir = mkdtempSync(join(tmpdir(), "agent-todo-remote-server-"));
		const dbPath = join(serverDir, "todo.db");
		await migrateMachineDb(dbPath);
		await seedMachineSuperuser(dbPath);
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(serverDir, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		});

		const clientPath = join(home, "client.toml");
		const cursorMcp = join(project, ".cursor", "mcp.json");
		const localDb = join(home, ".agent-todo", "todo.db");

		const proc = Bun.spawn(
			[
				"bun",
				cliEntry,
				"install",
				"--remote",
				"--url",
				runtime.baseUrl,
				"--username",
				"admin",
				"--password",
				TEST_ADMIN_PASSWORD,
			],
			{
				cwd: project,
				env: {
					...process.env,
					HOME: home,
					AGENT_TODO_INTEGRATION_HOME: home,
					AGENT_TODO_MACHINE_CLIENT: clientPath,
					AGENT_TODO_CURSOR_MCP_JSON: cursorMcp,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const stderr = await new Response(proc.stderr).text();
		expect(await proc.exited, stderr).toBe(0);
		expect(existsSync(localDb)).toBe(false);
		const client = readMachineClient(clientPath);
		expect(client?.url).toBe(runtime.baseUrl);
		if (existsSync(cursorMcp)) {
			const mcp = JSON.parse(readFileSync(cursorMcp, "utf8")) as {
				mcpServers?: Record<string, { url?: string }>;
			};
			expect(mcp.mcpServers?.["agent-todo"]?.url).toBe(`${runtime.baseUrl}/mcp`);
		}

		const again = Bun.spawn(
			[
				"bun",
				cliEntry,
				"install",
				"--remote",
				"--url",
				runtime.baseUrl,
				"--username",
				"admin",
				"--password",
				TEST_ADMIN_PASSWORD,
			],
			{
				cwd: project,
				env: {
					...process.env,
					HOME: home,
					AGENT_TODO_INTEGRATION_HOME: home,
					AGENT_TODO_MACHINE_CLIENT: clientPath,
					AGENT_TODO_CURSOR_MCP_JSON: cursorMcp,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		expect(await again.exited).toBe(0);
	});
});
