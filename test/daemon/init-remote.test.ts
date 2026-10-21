import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { configuredServerUnreachableMessage } from "../../packages/cli/src/commands/init.ts";
import { writeMachineClient } from "../../packages/cli/src/machine/client.ts";
import { bootOpenMachine } from "./machineBoot.ts";

const cliEntry = join(import.meta.dir, "../../packages/cli/src/index.ts");

describe("init against a saved remote server", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("ignores a dead AGENT_TODO_DAEMON_URL when the saved server is up", async () => {
		const { runtime, clientPath } = await bootOpenMachine(cleanups);
		writeMachineClient({ url: runtime.baseUrl }, clientPath);
		const repo = makeRepo(cleanups);

		const closed = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => new Response("closed"),
		});
		const deadEnvUrl = `http://127.0.0.1:${closed.port}`;
		cleanups.push(async () => closed.stop(true));

		const result = await runInit(repo, runtime.baseUrl, clientPath, deadEnvUrl);
		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");

		const config = readFileSync(join(repo, ".agent-todo", "config.toml"), "utf8");
		const code = config.match(/^project = "(.+)"$/m)?.[1];
		expect(code).toBeDefined();
		const listed = await listProjects(runtime.baseUrl);
		expect(listed.some((project) => project.code === code)).toBe(true);
		expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("Project code:");
		expect(readFileSync(join(repo, ".agent-todo", "config.toml"), "utf8")).toContain("project =");
	});

	test("names the saved URL when health fails and writes no project identity", async () => {
		const repo = makeRepo(cleanups);
		const clientPath = join(repo, "client.toml");
		const deadUrl = "http://127.0.0.1:9";
		writeMachineClient({ url: deadUrl }, clientPath);

		const result = await runInit(repo, deadUrl, clientPath);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toBe(`${configuredServerUnreachableMessage(deadUrl)}\n`);
		expect(result.stderr).not.toContain("machine daemon is not running");
		expect(await Bun.file(join(repo, "AGENTS.md")).exists()).toBe(false);
		expect(await Bun.file(join(repo, ".agent-todo", "config.toml")).exists()).toBe(false);
	});

	test("repeat init from trailing slash and dot paths stays one project", async () => {
		const { runtime, clientPath } = await bootOpenMachine(cleanups);
		writeMachineClient({ url: runtime.baseUrl }, clientPath);
		const repo = makeRepo(cleanups);

		expect((await runInit(repo, runtime.baseUrl, clientPath)).code).toBe(0);
		const first = await listProjects(runtime.baseUrl);
		expect(first).toHaveLength(1);

		expect((await runInit(`${repo}/`, runtime.baseUrl, clientPath)).code).toBe(0);
		expect((await runInit(join(repo, "."), runtime.baseUrl, clientPath)).code).toBe(0);
		expect(await listProjects(runtime.baseUrl)).toHaveLength(1);
	});

	test("repeat init from a symlink cwd keeps one project", async () => {
		const { runtime, clientPath } = await bootOpenMachine(cleanups);
		writeMachineClient({ url: runtime.baseUrl }, clientPath);
		const repo = makeRepo(cleanups);
		const link = join(tmpdir(), `agent-todo-init-link-${basename(repo)}`);
		symlinkSync(repo, link);
		cleanups.push(async () => rmSync(link, { force: true }));

		expect((await runInit(link, runtime.baseUrl, clientPath)).code).toBe(0);
		expect((await runInit(link, runtime.baseUrl, clientPath)).code).toBe(0);
		expect(await listProjects(runtime.baseUrl)).toHaveLength(1);
	});
});

function childEnv(daemonUrl: string, clientPath: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if (
			key === "AGENT_TODO_DB" ||
			key === "AGENT_TODO_PROJECT" ||
			key === "AGENT_TODO_DAEMON_URL" ||
			key === "AGENT_TODO_MACHINE_CLIENT"
		) {
			continue;
		}
		env[key] = value;
	}
	env.AGENT_TODO_DAEMON_URL = daemonUrl;
	env.AGENT_TODO_MACHINE_CLIENT = clientPath;
	return env;
}

async function runInit(
	cwd: string,
	savedUrl: string,
	clientPath: string,
	envDaemonUrl = savedUrl,
) {
	const proc = Bun.spawn([process.execPath, cliEntry, "init"], {
		cwd,
		env: childEnv(envDaemonUrl, clientPath),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr };
}

function makeRepo(cleanups: Array<() => Promise<void>>): string {
	const repo = mkdtempSync(join(tmpdir(), "agent-todo-init-remote-"));
	cleanups.push(async () => {
		rmSync(repo, { recursive: true, force: true });
	});
	return repo;
}

async function listProjects(baseUrl: string) {
	const res = await fetch(`${baseUrl}/api/projects`);
	expect(res.status).toBe(200);
	return ((await res.json()) as { projects: Array<{ code: string; name: string; path: string }> })
		.projects;
}
