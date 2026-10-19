import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readMachineClient } from "../../packages/cli/src/machine/client.ts";
import { BUILTIN_PLANNING_FLOW, readDaemonToml } from "../../packages/server/src/index.ts";
import { startMachineDaemon } from "../../packages/server/src/machineDaemon.ts";
import { migrateMachineDb } from "./machineBoot.ts";

const cliEntry = join(import.meta.dir, "../../packages/cli/src/index.ts");

describe("install and flow CLI", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("install --local --no-flow stores off and omits instructions", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-todo-flow-install-off-"));
		const project = join(home, "project");
		const dbPath = join(home, "machine", "todo.db");
		const daemonConfig = join(home, "daemon.toml");
		const clientPath = join(home, "client.toml");
		mkdirSync(join(project, ".cursor"), { recursive: true });
		mkdirSync(join(home, "machine"), { recursive: true });
		const cursorMcp = join(project, ".cursor", "mcp.json");
		const commandLog = join(home, "autostart.log");

		const port = await freePort();
		const baseUrl = `http://127.0.0.1:${port}`;

		const proc = Bun.spawn(["bun", cliEntry, "install", "--local", "--loopback", "--no-flow"], {
			cwd: project,
			env: {
				...process.env,
				HOME: home,
				AGENT_TODO_INTEGRATION_HOME: home,
				AGENT_TODO_DB: dbPath,
				AGENT_TODO_DAEMON_URL: baseUrl,
				AGENT_TODO_DAEMON_CONFIG: daemonConfig,
				AGENT_TODO_MACHINE_CLIENT: clientPath,
				AGENT_TODO_CURSOR_MCP_JSON: cursorMcp,
				AGENT_TODO_AUTOSTART_PLATFORM: "darwin",
				AGENT_TODO_AUTOSTART_COMMAND_LOG: commandLog,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const stderr = await new Response(proc.stderr).text();
		expect(await proc.exited, stderr).toBe(0);

		expect(readMachineClient(clientPath)?.flow).toBe("off");
		expect(readDaemonToml(daemonConfig).flow).toBe("off");
		cleanups.push(async () => {
			rmSync(home, { recursive: true, force: true });
		});

		const client = new Client({ name: "install-off", version: "0" });
		await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
		try {
			expect(client.getInstructions()).toBeUndefined();
		} finally {
			await client.close();
		}
	}, 40_000);

	test("install --url sets default flow without changing remote daemon.toml", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-todo-flow-ext-"));
		const project = join(home, "project");
		const clientPath = join(home, "client.toml");
		mkdirSync(join(project, ".cursor"), { recursive: true });
		const cursorMcp = join(project, ".cursor", "mcp.json");

		const serverDir = mkdtempSync(join(tmpdir(), "agent-todo-flow-ext-server-"));
		const dbPath = join(serverDir, "todo.db");
		const remoteDaemonConfig = join(serverDir, "daemon.toml");
		await migrateMachineDb(dbPath);
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(serverDir, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		});

		const proc = Bun.spawn(["bun", cliEntry, "install", "--url", runtime.baseUrl], {
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
		});
		expect(await proc.exited).toBe(0);
		expect(readMachineClient(clientPath)?.flow).toBe("default");
		expect(existsSync(remoteDaemonConfig)).toBe(false);

		const client = new Client({ name: "ext-default", version: "0" });
		await client.connect(new StreamableHTTPClientTransport(new URL(`${runtime.baseUrl}/mcp`)));
		try {
			expect(client.getInstructions()).toBe(BUILTIN_PLANNING_FLOW);
		} finally {
			await client.close();
		}
	}, 40_000);

	test("reinstall keeps saved flow and prints it", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-todo-flow-keep-"));
		const project = join(home, "project");
		const clientPath = join(home, "client.toml");
		mkdirSync(join(project, ".cursor"), { recursive: true });
		const cursorMcp = join(project, ".cursor", "mcp.json");
		writeFileSync(
			clientPath,
			`version = 1
url = "http://127.0.0.1:8787"
flow = "off"
`,
		);
		cleanups.push(async () => {
			rmSync(home, { recursive: true, force: true });
		});

		const proc = Bun.spawn(["bun", cliEntry, "install", "--url", "http://127.0.0.1:9"], {
			cwd: project,
			env: {
				...process.env,
				HOME: home,
				AGENT_TODO_MACHINE_CLIENT: clientPath,
				AGENT_TODO_CURSOR_MCP_JSON: cursorMcp,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await proc.exited).toBe(1);
		expect(readMachineClient(clientPath)?.flow).toBe("off");
	});
});

function writeFileSync(path: string, data: string): void {
	Bun.write(path, data);
}

async function freePort(): Promise<number> {
	const probe = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response("ok"),
	});
	const port = probe.port;
	probe.stop(true);
	return port;
}
