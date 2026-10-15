import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { GroupService } from "../../packages/core/src/index.ts";
import {
	ChangeHub,
	notifiableStore,
	startDaemonHttp,
	startMachineDaemon,
} from "../../packages/server/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

const cliEntry = join(import.meta.dir, "../../packages/cli/src/index.ts");
const proxyEntry = join(import.meta.dir, "../../packages/cli/src/daemon/proxy.ts");

function childEnv(home: string, daemonUrl: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if (
			key === "AGENT_TODO_DB" ||
			key === "AGENT_TODO_PROJECT" ||
			key === "AGENT_TODO_DAEMON_URL"
		) {
			continue;
		}
		env[key] = value;
	}
	env.HOME = home;
	env.AGENT_TODO_DAEMON_URL = daemonUrl;
	return env;
}

describe("stdio proxy to the machine daemon", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("forwards a tool call without a repository config or opening the database", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-stdio-proxy-"));
		const home = join(dir, "home");
		const cwd = join(dir, "empty-repo");
		const dbPath = join(dir, "todo.db");
		mkdirSync(home);
		mkdirSync(cwd);

		const seeded = await openStore({ path: dbPath });
		await new GroupService(seeded).create({ key: "PX", name: "Proxy" });
		await seeded.close();

		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});

		const marker = `proxied-${Date.now()}`;
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [cliEntry, "serve", "--mcp"],
			cwd,
			env: childEnv(home, runtime.baseUrl),
			stderr: "pipe",
		});
		const client = new Client({ name: "stdio-proxy-test", version: "0" });
		await client.connect(transport);
		cleanups.push(async () => {
			await client.close();
		});

		const created = await client.callTool({
			name: "task_create",
			arguments: { group: "PX", tasks: [{ title: marker }] },
		});
		expect(created.isError).toBeFalsy();

		const http = new Client({ name: "daemon-check", version: "0" });
		const httpTransport = new StreamableHTTPClientTransport(new URL(`${runtime.baseUrl}/mcp`));
		await http.connect(httpTransport);
		try {
			const listed = await http.callTool({ name: "task_list", arguments: { group: "PX" } });
			expect(JSON.stringify(listed)).toContain(marker);
		} finally {
			await http.close();
		}

		expect(await Bun.file(join(home, ".agent-todo", "todo.db")).exists()).toBe(false);
		expect(await Bun.file(join(cwd, ".agent-todo", "config.toml")).exists()).toBe(false);
	}, 20_000);

	test("exits nonzero and tells the user to run install when the daemon is down", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-stdio-down-"));
		const home = join(dir, "home");
		const cwd = join(dir, "empty-repo");
		mkdirSync(home);
		mkdirSync(cwd);
		cleanups.push(async () => {
			rmSync(dir, { recursive: true, force: true });
		});

		const probe = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => new Response("closed"),
		});
		const port = probe.port;
		probe.stop(true);

		const proc = Bun.spawn([process.execPath, cliEntry, "serve", "--mcp"], {
			cwd,
			env: childEnv(home, `http://127.0.0.1:${port}`),
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		const stderr = await new Response(proc.stderr).text();
		const code = await proc.exited;

		expect(code).not.toBe(0);
		expect(stderr).toContain("install");
		expect(await Bun.file(join(home, ".agent-todo", "todo.db")).exists()).toBe(false);
		expect(await Bun.file(join(cwd, ".agent-todo", "config.toml")).exists()).toBe(false);
	});

	test("forwards a resolved actor and keeps an explicit agent", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-stdio-actor-"));
		const home = join(dir, "home");
		const cwd = join(dir, "empty-repo");
		const dbPath = join(dir, "todo.db");
		mkdirSync(home);
		mkdirSync(cwd);

		const seeded = await openStore({ path: dbPath });
		await new GroupService(seeded).create({ key: "PX", name: "Proxy" });
		await seeded.close();

		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});

		const fromEnv = await proxyCall({
			home,
			cwd,
			daemonUrl: runtime.baseUrl,
			clientName: "local agent",
			envAgent: "proxy-env-actor",
			toolAgent: undefined,
		});
		expect(fromEnv.author).toBe("proxy-env-actor");

		const fromClient = await proxyCall({
			home,
			cwd,
			daemonUrl: runtime.baseUrl,
			clientName: "local agent",
			envAgent: undefined,
			toolAgent: undefined,
		});
		expect(fromClient.author).toBe(`local-agent-${fromClient.pid}`);

		const explicit = await proxyCall({
			home,
			cwd,
			daemonUrl: runtime.baseUrl,
			clientName: "local agent",
			envAgent: "proxy-env-actor",
			toolAgent: "explicit-actor",
		});
		expect(explicit.author).toBe("explicit-actor");

		const padded = await proxyCall({
			home,
			cwd,
			daemonUrl: runtime.baseUrl,
			clientName: " local agent ",
			envAgent: undefined,
			toolAgent: undefined,
		});
		expect(padded.author).toBe(`-local-agent--${padded.pid}`);

		const blankName = await proxyCall({
			home,
			cwd,
			daemonUrl: runtime.baseUrl,
			clientName: "   ",
			envAgent: undefined,
			toolAgent: undefined,
		});
		expect(blankName.author).toBe(`--${blankName.pid}`);

		const untrimmed = await proxyCall({
			home,
			cwd,
			daemonUrl: runtime.baseUrl,
			clientName: "local agent",
			envAgent: "proxy-env-actor",
			toolAgent: "  explicit actor  ",
		});
		expect(untrimmed.author).toBe("  explicit actor  ");
	}, 40_000);

	test("leaves agent unset when the proxy has a bearer so the token name wins", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-stdio-bearer-"));
		const home = join(dir, "home");
		const cwd = join(dir, "empty-repo");
		const dbPath = join(dir, "todo.db");
		mkdirSync(home);
		mkdirSync(cwd);

		const previous = process.env.AGENT_TODO_AGENT;
		process.env.AGENT_TODO_AGENT = "daemon-env-name";
		const seeded = await openStore({ path: dbPath });
		const hub = new ChangeHub();
		const store = notifiableStore(seeded, hub);
		await new GroupService(store).create({ key: "PX", name: "Proxy" });
		const runtime = await startDaemonHttp({
			store,
			changeHub: hub,
			port: 0,
			idleMs: null,
			localTokens: [{ name: "cloud-token", token: "secret-token" }],
		});
		cleanups.push(async () => {
			await runtime.stop();
			await store.close();
			rmSync(dir, { recursive: true, force: true });
			if (previous === undefined) delete process.env.AGENT_TODO_AGENT;
			else process.env.AGENT_TODO_AGENT = previous;
		});

		const fromToken = await proxyCall({
			home,
			cwd,
			daemonUrl: runtime.baseUrl,
			clientName: " local agent ",
			envAgent: "proxy-env-actor",
			toolAgent: undefined,
			bearer: "secret-token",
		});
		expect(fromToken.author).toBe("cloud-token");

		const blankAgent = await proxyCall({
			home,
			cwd,
			daemonUrl: runtime.baseUrl,
			clientName: "local agent",
			envAgent: "proxy-env-actor",
			toolAgent: "   ",
			bearer: "secret-token",
		});
		expect(blankAgent.author).toBe("cloud-token");

		const explicit = await proxyCall({
			home,
			cwd,
			daemonUrl: runtime.baseUrl,
			clientName: "local agent",
			envAgent: "proxy-env-actor",
			toolAgent: "explicit-actor",
			bearer: "secret-token",
		});
		expect(explicit.author).toBe("explicit-actor");
	}, 40_000);
});

function textOf(result: { content?: unknown }): string {
	return ((result.content as Array<{ text?: string }>) ?? [])
		.map((block) => block.text ?? "")
		.join("\n");
}

async function proxyCall(input: {
	home: string;
	cwd: string;
	daemonUrl: string;
	clientName: string;
	envAgent: string | undefined;
	toolAgent: string | undefined;
	bearer?: string;
}): Promise<{ author: string; pid: number }> {
	const env = childEnv(input.home, input.daemonUrl);
	delete env.AGENT_TODO_AGENT;
	if (input.envAgent !== undefined) env.AGENT_TODO_AGENT = input.envAgent;
	if (input.bearer !== undefined) env.PROXY_BEARER = input.bearer;

	const transport = new StdioClientTransport({
		command: process.execPath,
		args: input.bearer
			? [
					"-e",
					`import { runStdioMcpProxy } from ${JSON.stringify(proxyEntry)};
await runStdioMcpProxy(process.env.AGENT_TODO_DAEMON_URL + "/mcp", process.env.PROXY_BEARER);`,
				]
			: [cliEntry, "serve", "--mcp"],
		cwd: input.cwd,
		env,
		stderr: "pipe",
	});
	const client = new Client({ name: input.clientName, version: "0" });
	await client.connect(transport);
	try {
		const created = await client.callTool({
			name: "task_create",
			arguments: { group: "PX", tasks: [{ title: `actor-${Date.now()}-${Math.random()}` }] },
		});
		expect(created.isError).toBeFalsy();
		const createdLine = textOf(created).match(/^(\S+) v=(\d+)/m);
		if (!createdLine?.[1]) throw new Error(`missing task ack:\n${textOf(created)}`);

		const commentArgs: Record<string, unknown> = {
			task: createdLine[1],
			body: "actor check",
		};
		if (input.toolAgent !== undefined) commentArgs.agent = input.toolAgent;
		const comment = await client.callTool({ name: "comment_add", arguments: commentArgs });
		expect(comment.isError).toBeFalsy();

		const listed = await client.callTool({
			name: "comment_list",
			arguments: { task: createdLine[1], view: "full", format: "json" },
		});
		const comments = JSON.parse(textOf(listed)) as { comments: Array<{ author: string }> };
		const author = comments.comments[0]?.author;
		if (!author) throw new Error(`missing comment author:\n${textOf(listed)}`);
		const pid = transport.pid;
		if (pid == null) throw new Error("missing proxy pid");
		return { author, pid };
	} finally {
		await client.close();
	}
}
