import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { writeMachineClient } from "../../packages/cli/src/machine/client.ts";
import { bootOpenMachine } from "./machineBoot.ts";

const cliEntry = join(import.meta.dir, "../../packages/cli/src/index.ts");
const MARKER_START = "<!-- agent-todo:start -->";
const MARKER_END = "<!-- agent-todo:end -->";
const ID_LINE =
	"Use the project code to list or create groups, the group id to list or create what is inside a group, and the task id alone to read or update one task.";

describe("init writes ids into AGENTS.md", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("fails and tells the user to run install when the daemon is down", async () => {
		const repo = makeRepo(cleanups);
		const probe = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => new Response("closed"),
		});
		const port = probe.port;
		probe.stop(true);

		const result = await runInit(
			repo,
			`http://127.0.0.1:${port}`,
			join(repo, "missing-client.toml"),
		);

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("install");
		expect(await Bun.file(join(repo, "AGENTS.md")).exists()).toBe(false);
		expect(await Bun.file(join(repo, ".agent-todo", "todo.db")).exists()).toBe(false);
		expect(await Bun.file(join(repo, ".mcp.json")).exists()).toBe(false);
	});

	test("a new path creates a project and writes the marked block", async () => {
		const runtime = await boot(cleanups);
		const repo = makeRepo(cleanups);

		const result = await runInit(repo, runtime.baseUrl, runtime.clientPath);

		expect(result.code).toBe(0);
		const project = await findProject(runtime.baseUrl, repo);
		expect(project.code).toMatch(/^[A-Z]{3}$/);
		expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toBe(
			agentsBlock(project.code, project.groupId),
		);
	});

	test("the block names the project code, the default group id, and which id each kind of call uses", async () => {
		const runtime = await boot(cleanups);
		const repo = makeRepo(cleanups);
		expect((await runInit(repo, runtime.baseUrl, runtime.clientPath)).code).toBe(0);

		const project = await findProject(runtime.baseUrl, repo);
		const text = readFileSync(join(repo, "AGENTS.md"), "utf8");
		const block = markedBlock(text);
		expect(block).toContain(project.code);
		expect(block).toContain(project.groupId);
		expect(block).toContain(ID_LINE);
		expect(project.groupId).toBe(`${project.code}-1`);
	});

	test("the rest of an existing AGENTS.md is unchanged", async () => {
		const runtime = await boot(cleanups);
		const repo = makeRepo(cleanups);
		const before = "# Repo notes\n\nKeep this paragraph.\n\n";
		const after = "\n\n## Later\n\nDo not touch this section.\n";
		writeFileSync(
			join(repo, "AGENTS.md"),
			`${before}${MARKER_START}\nold project OLD-1\n${MARKER_END}${after}`,
			"utf8",
		);

		expect((await runInit(repo, runtime.baseUrl, runtime.clientPath)).code).toBe(0);

		const text = readFileSync(join(repo, "AGENTS.md"), "utf8");
		expect(text.startsWith(before)).toBe(true);
		expect(text.endsWith(after)).toBe(true);
		expect(text).not.toContain("OLD-1");
	});

	test("a missing AGENTS.md is created containing only that block", async () => {
		const runtime = await boot(cleanups);
		const repo = makeRepo(cleanups);

		expect((await runInit(repo, runtime.baseUrl, runtime.clientPath)).code).toBe(0);

		const project = await findProject(runtime.baseUrl, repo);
		expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toBe(
			agentsBlock(project.code, project.groupId),
		);
	});

	test("a file without markers keeps its original text and gains the block", async () => {
		const runtime = await boot(cleanups);
		const repo = makeRepo(cleanups);
		const original = "# Existing\n\nLeave every line here.\n";
		writeFileSync(join(repo, "AGENTS.md"), original, "utf8");

		expect((await runInit(repo, runtime.baseUrl, runtime.clientPath)).code).toBe(0);

		const text = readFileSync(join(repo, "AGENTS.md"), "utf8");
		expect(text.startsWith(original)).toBe(true);
		expect(markedBlock(text)).toContain(ID_LINE);
	});

	test("repeating init on the same path keeps the project and refreshes only the block", async () => {
		const runtime = await boot(cleanups);
		const repo = makeRepo(cleanups);
		expect((await runInit(repo, runtime.baseUrl, runtime.clientPath)).code).toBe(0);
		const first = await findProject(runtime.baseUrl, repo);

		const outside = "\n\n# Added after first init\n\nStill here.\n";
		const path = join(repo, "AGENTS.md");
		const current = readFileSync(path, "utf8");
		const edited = current
			.replace(ID_LINE, "stale ids WRONG-9")
			.replace(MARKER_END, `${MARKER_END}${outside}`);
		writeFileSync(path, edited, "utf8");
		const suffix = edited.slice(edited.indexOf(MARKER_END) + MARKER_END.length);

		expect((await runInit(repo, runtime.baseUrl, runtime.clientPath)).code).toBe(0);

		const text = readFileSync(path, "utf8");
		expect(text.slice(text.indexOf(MARKER_END) + MARKER_END.length)).toBe(suffix);
		expect(markedBlock(text)).toBe(agentsBlock(first.code, first.groupId).trimEnd());
		expect(text).not.toContain("WRONG-9");

		const listed = await listProjects(runtime.baseUrl);
		expect(listed.filter((project) => project.path === first.path)).toEqual([
			{ code: first.code, name: first.name, path: first.path },
		]);
		const groups = (await (await fetch(`${runtime.baseUrl}/api/groups`)).json()) as {
			groups: { key: string }[];
		};
		expect(groups.groups.map((group) => group.key)).toEqual([first.groupId]);
	});

	test("a new path joins the existing project when the file names its project code", async () => {
		const runtime = await boot(cleanups);
		const firstRepo = makeRepo(cleanups);
		expect((await runInit(firstRepo, runtime.baseUrl, runtime.clientPath)).code).toBe(0);
		const first = await findProject(runtime.baseUrl, firstRepo);

		const secondRepo = makeRepo(cleanups);
		writeFileSync(
			join(secondRepo, "AGENTS.md"),
			readFileSync(join(firstRepo, "AGENTS.md"), "utf8"),
			"utf8",
		);
		const notes = "# Copied notes\n\n";
		writeFileSync(
			join(secondRepo, "AGENTS.md"),
			`${notes}${readFileSync(join(secondRepo, "AGENTS.md"), "utf8")}`,
			"utf8",
		);

		expect((await runInit(secondRepo, runtime.baseUrl, runtime.clientPath)).code).toBe(0);

		const second = await findProject(runtime.baseUrl, secondRepo);
		expect(second.code).toBe(first.code);
		expect(second.groupId).toBe(first.groupId);
		const text = readFileSync(join(secondRepo, "AGENTS.md"), "utf8");
		expect(text.startsWith(notes)).toBe(true);
		expect(markedBlock(text)).toBe(agentsBlock(first.code, first.groupId).trimEnd());

		const listed = await listProjects(runtime.baseUrl);
		expect(listed.map((project) => project.code).sort()).toEqual([first.code]);
	});

	test("does not create a repository-local database or a repository MCP entry", async () => {
		const runtime = await boot(cleanups);
		const repo = makeRepo(cleanups);
		mkdirSync(join(repo, ".cursor"));
		writeFileSync(join(repo, ".gitignore"), "node_modules\n", "utf8");

		expect((await runInit(repo, runtime.baseUrl, runtime.clientPath)).code).toBe(0);

		expect(await Bun.file(join(repo, ".agent-todo", "todo.db")).exists()).toBe(false);
		expect(await Bun.file(join(repo, ".agent-todo", "config.toml")).exists()).toBe(true);
		expect(await Bun.file(join(repo, ".mcp.json")).exists()).toBe(false);
		expect(await Bun.file(join(repo, ".cursor", "rules", "agent-todo.mdc")).exists()).toBe(false);
		expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe("node_modules\n");
	});

	test("does not import AGENTS.md or CLAUDE.md into the group's context", async () => {
		const runtime = await boot(cleanups);
		const repo = makeRepo(cleanups);
		const claude = "# Claude\n\n## Secret heading\n\nDo not import this body.\n";
		const agents = "# Agents\n\n## Other heading\n\nLeave this out of the group.\n";
		writeFileSync(join(repo, "CLAUDE.md"), claude, "utf8");
		writeFileSync(join(repo, "AGENTS.md"), agents, "utf8");

		expect((await runInit(repo, runtime.baseUrl, runtime.clientPath)).code).toBe(0);

		const project = await findProject(runtime.baseUrl, repo);
		const context = await fetch(
			`${runtime.baseUrl}/api/groups/${encodeURIComponent(project.groupId)}/context`,
			{},
		);
		expect(context.status).toBe(200);
		expect(await context.json()).toEqual({
			group: { key: project.groupId, name: basename(project.path) },
			toc: [],
			sections: [],
		});
		expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toBe(claude);
		expect(readFileSync(join(repo, "AGENTS.md"), "utf8").startsWith(agents)).toBe(true);
	});
});

type RegisteredProject = {
	code: string;
	name: string;
	path: string;
	groupId: string;
	created: boolean;
};

function agentsBlock(code: string, groupId: string): string {
	return `${MARKER_START}
Project code: ${code}
Default group: ${groupId}
${ID_LINE}
${MARKER_END}
`;
}

function markedBlock(text: string): string {
	const start = text.indexOf(MARKER_START);
	const end = text.indexOf(MARKER_END);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	return text.slice(start, end + MARKER_END.length);
}

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

async function runInit(cwd: string, daemonUrl: string, clientPath: string) {
	const proc = Bun.spawn([process.execPath, cliEntry, "init"], {
		cwd,
		env: childEnv(daemonUrl, clientPath),
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

async function boot(cleanups: Array<() => Promise<void>>) {
	const { runtime, clientPath } = await bootOpenMachine(cleanups);
	writeMachineClient({ url: runtime.baseUrl }, clientPath);
	return { ...runtime, clientPath };
}

function makeRepo(cleanups: Array<() => Promise<void>>): string {
	const repo = mkdtempSync(join(tmpdir(), "agent-todo-init-repo-"));
	cleanups.push(async () => {
		rmSync(repo, { recursive: true, force: true });
	});
	return repo;
}

async function listProjects(baseUrl: string) {
	const res = await fetch(`${baseUrl}/api/projects`);
	expect(res.status).toBe(200);
	const body = (await res.json()) as {
		projects: Array<{ code: string; name: string; path: string }>;
	};
	return body.projects;
}

async function findProject(baseUrl: string, repo: string): Promise<RegisteredProject> {
	const listed = await listProjects(baseUrl);
	const canonical = realpathSync(repo);
	const agentsText = readFileSync(join(repo, "AGENTS.md"), "utf8");
	const codeLine = agentsText
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.startsWith("Project code:"));
	const code = codeLine?.slice("Project code:".length).trim();
	const match =
		listed.find((project) => project.path === canonical) ??
		(code ? listed.find((project) => project.code === code) : undefined);
	expect(match).toBeDefined();
	const res = await fetch(`${baseUrl}/api/projects`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(code ? { code } : { path: repo }),
	});
	expect(res.status).toBe(200);
	const body = (await res.json()) as RegisteredProject;
	expect(body.created).toBe(false);
	expect(body.code).toBe(match?.code);
	return body;
}
