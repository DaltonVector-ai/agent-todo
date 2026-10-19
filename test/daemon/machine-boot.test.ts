import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	MACHINE_DAEMON_HOST,
	MACHINE_DAEMON_PORT,
	MACHINE_NETWORK_HOST,
	machineDatabasePath,
	startMachineDaemon,
	writeMachineListenHost,
} from "../../packages/server/src/index.ts";

describe("machine daemon boot", () => {
	const cleanups: Array<() => Promise<void>> = [];
	const prevTokens = process.env.AGENT_TODO_TOKENS;
	const prevIdle = process.env.AGENT_TODO_DAEMON_IDLE_MS;

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
		if (prevTokens === undefined) delete process.env.AGENT_TODO_TOKENS;
		else process.env.AGENT_TODO_TOKENS = prevTokens;
		if (prevIdle === undefined) delete process.env.AGENT_TODO_DAEMON_IDLE_MS;
		else process.env.AGENT_TODO_DAEMON_IDLE_MS = prevIdle;
	});

	test("defaults are loopback port 8787 and the home machine database", () => {
		expect(MACHINE_DAEMON_HOST).toBe("127.0.0.1");
		expect(MACHINE_DAEMON_PORT).toBe(8787);
		expect(machineDatabasePath()).toBe(join(homedir(), ".agent-todo", "todo.db"));
		const override = join(tmpdir(), "override-todo.db");
		expect(machineDatabasePath(override)).toBe(override);
	});

	test("serves an empty machine database on loopback with no token", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-machine-"));
		const dbPath = join(dir, "todo.db");
		const configPath = join(dir, "daemon.toml");
		process.env.AGENT_TODO_DAEMON_CONFIG = configPath;
		const { migrateMachineDb } = await import("./machineBoot.ts");
		await migrateMachineDb(dbPath);
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			delete process.env.AGENT_TODO_DAEMON_CONFIG;
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});

		expect(runtime.host).toBe("127.0.0.1");
		expect(runtime.port).toBeGreaterThan(0);
		expect(runtime.port).not.toBe(MACHINE_DAEMON_PORT);
		expect(new URL(runtime.baseUrl).hostname).toBe("127.0.0.1");
		expect(runtime.dbPath).toBe(dbPath);

		const health = await fetch(`${runtime.baseUrl}/health`);
		expect(health.status).toBe(200);
		expect(await health.json()).toEqual({ status: "ok", service: "agent-todo" });

		const groups = await fetch(`${runtime.baseUrl}/api/groups`);
		expect(groups.status).toBe(200);
		expect(await groups.json()).toEqual({ rev: 0, groups: [] });

		const exported = await fetch(`${runtime.baseUrl}/api/sync/export`);
		expect(exported.status).toBe(200);
	});

	test("reads saved network listen host on boot", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-machine-net-"));
		const dbPath = join(dir, "todo.db");
		const configPath = join(dir, "daemon.toml");
		process.env.AGENT_TODO_DAEMON_CONFIG = configPath;
		writeMachineListenHost(MACHINE_NETWORK_HOST, configPath);
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			delete process.env.AGENT_TODO_DAEMON_CONFIG;
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});
		expect(runtime.host).toBe(MACHINE_NETWORK_HOST);
	});

	test("stays up past the per-project daemon idle period", async () => {
		process.env.AGENT_TODO_DAEMON_IDLE_MS = "40";
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-machine-idle-"));
		const dbPath = join(dir, "todo.db");
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});

		let stopped = false;
		void runtime.stopped.then(() => {
			stopped = true;
		});
		await Bun.sleep(200);

		expect(stopped).toBe(false);
		const health = await fetch(`${runtime.baseUrl}/health`);
		expect(health.status).toBe(200);
		expect(await health.json()).toEqual({ status: "ok", service: "agent-todo" });
	});
});
