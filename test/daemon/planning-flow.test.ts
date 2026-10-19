import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
	BUILTIN_PLANNING_FLOW,
	FLOW_MAX_BYTES,
	startMachineDaemon,
	writeDaemonToml,
	writeMachineListenHost,
} from "../../packages/server/src/index.ts";
import { migrateMachineDb } from "./machineBoot.ts";

const cliEntry = join(import.meta.dir, "../../packages/cli/src/index.ts");

async function connectHttp(baseUrl: string, flow?: string): Promise<Client> {
	const url = new URL(`${baseUrl}/mcp`);
	if (flow !== undefined) url.searchParams.set("flow", flow);
	const client = new Client({ name: "flow-test", version: "0" });
	const transport = new StreamableHTTPClientTransport(url);
	await client.connect(transport);
	return client;
}

describe("planning flow over HTTP", () => {
	const cleanups: Array<() => Promise<void>> = [];
	let prevDaemonConfig: string | undefined;
	let prevFlowsDir: string | undefined;

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
		if (prevDaemonConfig === undefined) delete process.env.AGENT_TODO_DAEMON_CONFIG;
		else process.env.AGENT_TODO_DAEMON_CONFIG = prevDaemonConfig;
		if (prevFlowsDir === undefined) delete process.env.AGENT_TODO_FLOWS_DIR;
		else process.env.AGENT_TODO_FLOWS_DIR = prevFlowsDir;
	});

	test("no query and missing daemon flow key return built-in instructions", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-flow-"));
		const dbPath = join(dir, "todo.db");
		const configPath = join(dir, "daemon.toml");
		const flowsDir = join(dir, "flows");
		mkdirSync(flowsDir);
		prevDaemonConfig = process.env.AGENT_TODO_DAEMON_CONFIG;
		prevFlowsDir = process.env.AGENT_TODO_FLOWS_DIR;
		process.env.AGENT_TODO_DAEMON_CONFIG = configPath;
		process.env.AGENT_TODO_FLOWS_DIR = flowsDir;
		writeMachineListenHost("127.0.0.1", configPath);
		await migrateMachineDb(dbPath);
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});

		const client = await connectHttp(runtime.baseUrl);
		try {
			expect(client.getInstructions()).toBe(BUILTIN_PLANNING_FLOW);
			const tools = await client.listTools();
			expect(tools.tools.length).toBeGreaterThan(0);
		} finally {
			await client.close();
		}
	}, 20_000);

	test("?flow=default when daemon default is off", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-flow-default-"));
		const dbPath = join(dir, "todo.db");
		const configPath = join(dir, "daemon.toml");
		const flowsDir = join(dir, "flows");
		mkdirSync(flowsDir);
		process.env.AGENT_TODO_DAEMON_CONFIG = configPath;
		process.env.AGENT_TODO_FLOWS_DIR = flowsDir;
		writeDaemonToml({ listenHost: "127.0.0.1", flow: "off" }, configPath);
		await migrateMachineDb(dbPath);
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});

		const client = await connectHttp(runtime.baseUrl, "default");
		try {
			expect(client.getInstructions()).toBe(BUILTIN_PLANNING_FLOW);
		} finally {
			await client.close();
		}
	}, 20_000);

	test("?flow=off and invalid slugs omit instructions without fallback", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-flow-off-"));
		const dbPath = join(dir, "todo.db");
		const configPath = join(dir, "daemon.toml");
		const flowsDir = join(dir, "flows");
		mkdirSync(flowsDir);
		process.env.AGENT_TODO_DAEMON_CONFIG = configPath;
		process.env.AGENT_TODO_FLOWS_DIR = flowsDir;
		await migrateMachineDb(dbPath);
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});

		for (const flow of ["off", "missing-slug", "../escape"]) {
			const client = await connectHttp(runtime.baseUrl, flow);
			try {
				expect(client.getInstructions()).toBeUndefined();
				await client.listTools();
			} finally {
				await client.close();
			}
		}

		const blankQuery = await connectHttp(runtime.baseUrl, "");
		try {
			expect(blankQuery.getInstructions()).toBeUndefined();
		} finally {
			await blankQuery.close();
		}

		writeFileSync(join(flowsDir, "empty.md"), "\n");
		writeFileSync(join(flowsDir, "big.md"), "x".repeat(FLOW_MAX_BYTES + 1));
		writeFileSync(join(flowsDir, "custom.md"), "Custom flow body");
		for (const flow of ["empty", "big"]) {
			const client = await connectHttp(runtime.baseUrl, flow);
			try {
				expect(client.getInstructions()).toBeUndefined();
			} finally {
				await client.close();
			}
		}

		const custom = await connectHttp(runtime.baseUrl, "custom");
		try {
			expect(custom.getInstructions()).toBe("Custom flow body");
		} finally {
			await custom.close();
		}
	}, 30_000);

	test("edited flow file appears on the next connection", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-flow-edit-"));
		const dbPath = join(dir, "todo.db");
		const configPath = join(dir, "daemon.toml");
		const flowsDir = join(dir, "flows");
		mkdirSync(flowsDir);
		const flowPath = join(flowsDir, "team.md");
		writeFileSync(flowPath, "version one");
		process.env.AGENT_TODO_DAEMON_CONFIG = configPath;
		process.env.AGENT_TODO_FLOWS_DIR = flowsDir;
		await migrateMachineDb(dbPath);
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});

		const first = await connectHttp(runtime.baseUrl, "team");
		await first.close();
		writeFileSync(flowPath, "version two");
		const second = await connectHttp(runtime.baseUrl, "team");
		try {
			expect(second.getInstructions()).toBe("version two");
		} finally {
			await second.close();
		}
	}, 20_000);

	test("saving flow preserves listen host", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-flow-host-"));
		const configPath = join(dir, "daemon.toml");
		writeDaemonToml({ listenHost: "0.0.0.0", flow: "default" }, configPath);
		const text = readFileSync(configPath, "utf8");
		expect(text).toContain('listen_host = "0.0.0.0"');
		expect(text).toContain('flow = "default"');
		rmSync(dir, { recursive: true, force: true });
	});

	test("stdio proxy forwards resolved instructions from client.toml flow", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-flow-proxy-"));
		const home = join(dir, "home");
		const cwd = join(dir, "empty-repo");
		const dbPath = join(dir, "todo.db");
		const configPath = join(dir, "daemon.toml");
		const flowsDir = join(dir, "flows");
		const clientPath = join(home, "client.toml");
		mkdirSync(home);
		mkdirSync(cwd);
		mkdirSync(flowsDir);
		process.env.AGENT_TODO_DAEMON_CONFIG = configPath;
		process.env.AGENT_TODO_FLOWS_DIR = flowsDir;
		writeDaemonToml({ listenHost: "127.0.0.1", flow: "off" }, configPath);
		await migrateMachineDb(dbPath);
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});

		writeFileSync(
			clientPath,
			`version = 1
url = "${runtime.baseUrl}"
flow = "default"
`,
		);

		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (value === undefined) continue;
			if (key === "AGENT_TODO_DAEMON_URL" || key === "AGENT_TODO_MACHINE_CLIENT") continue;
			env[key] = value;
		}
		env.HOME = home;
		env.AGENT_TODO_DAEMON_URL = runtime.baseUrl;
		env.AGENT_TODO_MACHINE_CLIENT = clientPath;
		env.AGENT_TODO_DAEMON_CONFIG = configPath;
		env.AGENT_TODO_FLOWS_DIR = flowsDir;

		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [cliEntry, "serve", "--mcp"],
			cwd,
			env,
			stderr: "pipe",
		});
		const client = new Client({ name: "proxy-flow", version: "0" });
		await client.connect(transport);
		try {
			expect(client.getInstructions()).toBe(BUILTIN_PLANNING_FLOW);
		} finally {
			await client.close();
		}
	}, 25_000);
});
