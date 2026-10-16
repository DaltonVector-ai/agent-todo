import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMachineClient } from "../../packages/cli/src/machine/client.ts";
import { startMachineDaemon } from "../../packages/server/src/index.ts";
import { migrateMachineDb } from "./machineBoot.ts";

const cliEntry = join(import.meta.dir, "../../packages/cli/src/index.ts");

describe("external install", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("install --url writes remote MCP URL without starting a local database", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-todo-remote-"));
		const project = join(home, "project");
		mkdirSync(join(project, ".cursor"), { recursive: true });
		const serverDir = mkdtempSync(join(tmpdir(), "agent-todo-remote-server-"));
		const dbPath = join(serverDir, "todo.db");
		await migrateMachineDb(dbPath);
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(serverDir, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		});

		const clientPath = join(home, "client.toml");
		const cursorMcp = join(project, ".cursor", "mcp.json");
		const localDb = join(home, ".agent-todo", "todo.db");

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
		const stderr = await new Response(proc.stderr).text();
		expect(await proc.exited, stderr).toBe(0);
		expect(existsSync(localDb)).toBe(false);
		const client = readMachineClient(clientPath);
		expect(client?.url).toBe(runtime.baseUrl);
		const mcp = JSON.parse(readFileSync(cursorMcp, "utf8")) as {
			mcpServers?: Record<string, { url?: string; headers?: unknown }>;
		};
		expect(mcp.mcpServers?.["agent-todo"]?.url).toBe(`${runtime.baseUrl}/mcp`);
		expect(mcp.mcpServers?.["agent-todo"]?.headers).toBeUndefined();
	});

	test("rejects a bad URL before changing agent config", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-todo-remote-bad-"));
		const project = join(home, "project");
		mkdirSync(join(project, ".cursor"), { recursive: true });
		const cursorMcp = join(project, ".cursor", "mcp.json");
		writeFileSync(cursorMcp, "{}\n");
		cleanups.push(async () => {
			rmSync(home, { recursive: true, force: true });
		});

		const proc = Bun.spawn(["bun", cliEntry, "install", "--url", "http://127.0.0.1:9"], {
			cwd: project,
			env: {
				...process.env,
				HOME: home,
				AGENT_TODO_INTEGRATION_HOME: home,
				AGENT_TODO_CURSOR_MCP_JSON: cursorMcp,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await proc.exited).toBe(1);
		expect(readFileSync(cursorMcp, "utf8")).toBe("{}\n");
	});

	test("stops a local install when switching to an external server", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-todo-remote-switch-"));
		const project = join(home, "project");
		mkdirSync(join(project, ".cursor"), { recursive: true });
		const localDb = join(home, "machine", "todo.db");
		mkdirSync(join(home, "machine"), { recursive: true });
		const clientPath = join(home, "client.toml");
		const cursorMcp = join(project, ".cursor", "mcp.json");
		const commandLog = join(home, "autostart.log");

		const remoteDir = mkdtempSync(join(tmpdir(), "agent-todo-remote-host-"));
		const remoteDb = join(remoteDir, "todo.db");
		await migrateMachineDb(remoteDb);
		const remoteRuntime = await startMachineDaemon({ dbPath: remoteDb, port: 0 });

		cleanups.push(async () => {
			await remoteRuntime.stop();
			rmSync(remoteDir, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		});

		const localPort = await freePort();
		const localInstall = Bun.spawn(
			["bun", cliEntry, "install", "--local", "--loopback"],
			{
				cwd: project,
				env: {
					...process.env,
					HOME: home,
					AGENT_TODO_INTEGRATION_HOME: home,
					AGENT_TODO_DB: localDb,
					AGENT_TODO_DAEMON_URL: `http://127.0.0.1:${localPort}`,
					AGENT_TODO_MACHINE_CLIENT: clientPath,
					AGENT_TODO_CURSOR_MCP_JSON: cursorMcp,
					AGENT_TODO_AUTOSTART_PLATFORM: "darwin",
					AGENT_TODO_AUTOSTART_COMMAND_LOG: commandLog,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const localErr = await new Response(localInstall.stderr).text();
		expect(await localInstall.exited, localErr).toBe(0);
		const localUrl = readMachineClient(clientPath)?.url;
		expect(localUrl).toBe(`http://127.0.0.1:${localPort}`);

		const switchProc = Bun.spawn(["bun", cliEntry, "install", "--url", remoteRuntime.baseUrl], {
			cwd: project,
			env: {
				...process.env,
				HOME: home,
				AGENT_TODO_INTEGRATION_HOME: home,
				AGENT_TODO_DB: localDb,
				AGENT_TODO_DAEMON_URL: `http://127.0.0.1:${localPort}`,
				AGENT_TODO_MACHINE_CLIENT: clientPath,
				AGENT_TODO_CURSOR_MCP_JSON: cursorMcp,
				AGENT_TODO_AUTOSTART_PLATFORM: "darwin",
				AGENT_TODO_AUTOSTART_COMMAND_LOG: commandLog,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const switchErr = await new Response(switchProc.stderr).text();
		expect(await switchProc.exited, switchErr).toBe(0);
		expect(readMachineClient(clientPath)?.url).toBe(remoteRuntime.baseUrl);
		expect(existsSync(localDb)).toBe(true);
		const health = await fetch(`${localUrl}/health`).catch(() => null);
		expect(health?.ok).not.toBe(true);
	}, 45_000);
});

async function freePort(): Promise<number> {
	const { createServer } = await import("node:net");
	return await new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				server.close();
				reject(new Error("no port"));
				return;
			}
			const port = addr.port;
			server.close(() => resolve(port));
		});
	});
}
