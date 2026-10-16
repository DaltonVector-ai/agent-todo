import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { GroupService, TaskService } from "../../packages/core/src/index.ts";
import { ChangeHub, createApp } from "../../packages/server/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";
import { authHeaders, bootAuthedMachine } from "./machineAuth.ts";

describe("machine board project scope", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("lists projects and scopes the board across zero, one, and two directories", async () => {
		const { runtime, token } = await bootAuthedMachine(cleanups);
		const alphaDir = makeDir("board-alpha-");
		const betaDir = makeDir("board-beta-");
		const client = new Client({ name: "board-project-test", version: "0" });
		let clientConnected = false;
		cleanups.push(async () => {
			if (clientConnected) await client.close();
			rmSync(alphaDir, { recursive: true, force: true });
			rmSync(betaDir, { recursive: true, force: true });
		});

		expect(await listProjects(runtime.baseUrl, token)).toEqual([]);
		const emptyBoard = await readBoard(runtime.baseUrl, token);
		expect(titles(emptyBoard)).toEqual([]);
		expect(emptyBoard.groups).toEqual([]);
		const emptyGroups = await readGroups(runtime.baseUrl, token);
		expect(emptyGroups.groups).toEqual([]);

		const alpha = await register(runtime.baseUrl, alphaDir, token);
		expect(await listProjects(runtime.baseUrl, token)).toEqual([
			{ code: alpha.code, name: alpha.name, path: alpha.path },
		]);
		expect(alpha.name).toBe(basename(alpha.path));
		const oneBoard = await readBoard(runtime.baseUrl, token, alpha.code);
		expect(titles(oneBoard)).toEqual([]);
		expect(oneBoard.groups.map((group) => group.key)).toEqual([alpha.groupId]);
		const oneGroups = await readGroups(runtime.baseUrl, token, alpha.code);
		expect(oneGroups.groups.map((group) => group.key)).toEqual([alpha.groupId]);
		const impliedBoard = await readBoard(runtime.baseUrl, token);
		expect(impliedBoard.groups.map((group) => group.key)).toEqual([alpha.groupId]);
		expect(titles(impliedBoard)).toEqual([]);
		const impliedGroups = await readGroups(runtime.baseUrl, token);
		expect(impliedGroups.groups.map((group) => group.key)).toEqual([alpha.groupId]);

		const beta = await register(runtime.baseUrl, betaDir, token);
		expect(beta.code).not.toBe(alpha.code);
		const transport = new StreamableHTTPClientTransport(new URL(`${runtime.baseUrl}/mcp`), {
			requestInit: { headers: authHeaders(token) },
		});
		await client.connect(transport);
		clientConnected = true;

		const extra = (await client.callTool({
			name: "group_create",
			arguments: { project: alpha.code, name: "Api" },
		})) as { isError?: boolean; structuredContent?: { id?: string } };
		expect(extra.isError).toBeFalsy();
		const extraId = extra.structuredContent?.id;
		expect(extraId).toBe(`${alpha.code}-2`);

		expect(
			(
				await client.callTool({
					name: "task_create",
					arguments: { group: alpha.groupId, tasks: [{ title: "Alpha task" }] },
				})
			).isError,
		).toBeFalsy();
		expect(
			(
				await client.callTool({
					name: "task_create",
					arguments: { group: beta.groupId, tasks: [{ title: "Beta task" }] },
				})
			).isError,
		).toBeFalsy();

		const alphaGroups = await readGroups(runtime.baseUrl, token, alpha.code);
		expect(alphaGroups.groups.map((group) => group.key).sort()).toEqual(
			[alpha.groupId, extraId].sort(),
		);
		const alphaBoard = await readBoard(runtime.baseUrl, token, alpha.code);
		expect(titles(alphaBoard)).toEqual(["Alpha task"]);
		expect(alphaBoard.groups.map((group) => group.key).sort()).toEqual(
			[alpha.groupId, extraId].sort(),
		);

		const betaBoard = await readBoard(runtime.baseUrl, token, beta.code);
		expect(titles(betaBoard)).toEqual(["Beta task"]);
		expect(betaBoard.groups.map((group) => group.key)).toEqual([beta.groupId]);
		const betaGroups = await readGroups(runtime.baseUrl, token, beta.code);
		expect(betaGroups.groups.map((group) => group.key)).toEqual([beta.groupId]);
		const mixedBoard = await readBoard(runtime.baseUrl, token);
		expect(titles(mixedBoard)).toEqual([]);
		expect(mixedBoard.groups).toEqual([]);
		const mixedGroups = await readGroups(runtime.baseUrl, token);
		expect(mixedGroups.groups).toEqual([]);

		const missingBoard = await readBoard(runtime.baseUrl, token, "NOPE");
		expect(titles(missingBoard)).toEqual([]);
		expect(missingBoard.groups).toEqual([]);
		const missingGroups = await readGroups(runtime.baseUrl, token, "NOPE");
		expect(missingGroups.groups).toEqual([]);

		let revisions = 0;
		const ac = new AbortController();
		const res = await fetch(`${runtime.baseUrl}/api/events/stream`, {
			signal: ac.signal,
			headers: authHeaders(token),
		});
		const reader = res.body?.getReader();
		if (!reader) throw new Error("no body");
		const dec = new TextDecoder();
		const waitForRevisions = async (count: number) => {
			const start = Date.now();
			while (revisions < count && Date.now() - start < 2000) {
				const { value, done } = await reader.read();
				if (done) break;
				revisions += dec.decode(value).match(/"rev"/g)?.length ?? 0;
			}
		};
		await waitForRevisions(1);
		expect(
			(
				await client.callTool({
					name: "task_create",
					arguments: { group: alpha.groupId, tasks: [{ title: "Live alpha" }] },
				})
			).isError,
		).toBeFalsy();
		await waitForRevisions(2);
		ac.abort();

		const live = await readBoard(runtime.baseUrl, token, alpha.code);
		expect(revisions).toBeGreaterThanOrEqual(2);
		expect(titles(live)).toContain("Live alpha");
		expect(titles(live)).not.toContain("Beta task");
		expect(titles(await readBoard(runtime.baseUrl, token, beta.code))).toEqual(["Beta task"]);
		expect(live.rev).toBeGreaterThanOrEqual(alphaBoard.rev);

		for (const path of [
			`/p/${alpha.code}`,
			`/p/${alpha.code}/g/${alpha.groupId}`,
			`/p/${alpha.code}/g/${alpha.groupId}/context`,
			`/p/${alpha.code}/g/${alpha.groupId}/t/${alpha.groupId}-1`,
		]) {
			const page = await fetch(`${runtime.baseUrl}${path}`);
			expect(page.status).toBe(200);
			expect(page.headers.get("content-type")).toContain("text/html");
		}
	});
});

describe("cloud board project", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("exposes the single public project and does not mix in another tenant", async () => {
		const publicDir = mkdtempSync(join(tmpdir(), "cloud-board-public-"));
		const otherDir = mkdtempSync(join(tmpdir(), "cloud-board-other-"));
		const publicStore = await openStore({ path: join(publicDir, "todo.db") });
		const otherStore = await openStore({ path: join(otherDir, "todo.db") });
		cleanups.push(async () => {
			await publicStore.close();
			await otherStore.close();
			rmSync(publicDir, { recursive: true, force: true });
			rmSync(otherDir, { recursive: true, force: true });
		});

		const publicGroups = new GroupService(publicStore);
		const publicTasks = new TaskService(publicStore);
		const otherGroups = new GroupService(otherStore);
		const otherTasks = new TaskService(otherStore);
		await publicGroups.create({ key: "WEB", name: "Web" });
		await publicTasks.create("WEB", [{ title: "Visible task", status: "open" }]);
		await otherGroups.create({ key: "LEAK", name: "Leak" });
		await otherTasks.create("LEAK", [{ title: "Other tenant task", status: "todo" }]);

		const hub = new ChangeHub();
		const app = createApp({
			changeHub: hub,
			publicBoard: {
				store: publicStore,
				projectPk: "public-pk",
				project: { code: "demo", name: "demo", path: "acme/demo" },
			},
			resolveContext: async () => ({
				store: otherStore,
				toolsets: ["core"],
				actorName: "other",
				projectPk: "other-pk",
			}),
		});

		const projects = await app.request("/api/projects");
		expect(projects.status).toBe(200);
		expect(await projects.json()).toEqual({
			projects: [{ code: "demo", name: "demo", path: "acme/demo" }],
		});

		const board = await readJson(await app.request("/api/board?project=demo"));
		expect(titles(board)).toEqual(["Visible task"]);
		expect(titles(board)).not.toContain("Other tenant task");
		expect(board.groups.map((group) => group.key)).toEqual(["WEB"]);

		const page = await app.request("/p/demo/g/WEB/context");
		expect(page.status).toBe(200);
		expect(page.headers.get("content-type")).toContain("text/html");

		const implied = createApp({
			changeHub: hub,
			publicBoard: { store: publicStore, projectPk: "public-pk" },
			resolveContext: async () => null,
		});
		const impliedProjects = await readJson(await implied.request("/api/projects"));
		expect(impliedProjects.projects).toEqual([
			{ code: "public-pk", name: "public-pk", path: "public-pk" },
		]);

		const empty = createApp({
			changeHub: hub,
			publicBoard: { store: null, projectPk: null },
			resolveContext: async () => null,
		});
		expect(await (await empty.request("/api/projects")).json()).toEqual({ projects: [] });
		const emptyBoard = await readJson(await empty.request("/api/board"));
		expect(titles(emptyBoard)).toEqual([]);
		expect(JSON.stringify(emptyBoard)).not.toContain("Other tenant task");
	});
});

type BoardBody = {
	rev: number;
	groups: { key: string; name: string }[];
	columns: Record<string, { title: string; groupKey: string }[]>;
};

type GroupsBody = { rev: number; groups: { key: string }[] };

function titles(board: { columns: Record<string, { title: string }[]> }): string[] {
	return Object.values(board.columns)
		.flat()
		.map((task) => task.title);
}

async function listProjects(baseUrl: string, token: string) {
	const res = await fetch(`${baseUrl}/api/projects`, { headers: authHeaders(token) });
	expect(res.status).toBe(200);
	return ((await res.json()) as { projects: { code: string; name: string; path: string }[] })
		.projects;
}

async function readBoard(baseUrl: string, token: string, project?: string): Promise<BoardBody> {
	const query = project ? `?project=${encodeURIComponent(project)}` : "";
	const res = await fetch(`${baseUrl}/api/board${query}`, { headers: authHeaders(token) });
	expect(res.status).toBe(200);
	return (await res.json()) as BoardBody;
}

async function readGroups(baseUrl: string, token: string, project?: string): Promise<GroupsBody> {
	const query = project ? `?project=${encodeURIComponent(project)}` : "";
	const res = await fetch(`${baseUrl}/api/groups${query}`, { headers: authHeaders(token) });
	expect(res.status).toBe(200);
	return (await res.json()) as GroupsBody;
}

async function readJson(res: Response): Promise<BoardBody & { projects?: unknown }> {
	expect(res.status).toBe(200);
	return (await res.json()) as BoardBody & { projects?: unknown };
}

function makeDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

async function register(baseUrl: string, path: string, token: string) {
	const res = await fetch(`${baseUrl}/api/projects`, {
		method: "POST",
		headers: { "content-type": "application/json", ...authHeaders(token) },
		body: JSON.stringify({ path }),
	});
	expect(res.status).toBe(200);
	const body = (await res.json()) as {
		code: string;
		name: string;
		path: string;
		groupId: string;
		created: boolean;
	};
	expect(body.path).toBe(realpathSync(path));
	return body;
}
