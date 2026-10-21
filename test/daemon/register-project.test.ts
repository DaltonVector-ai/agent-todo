import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { normalizeRegistrationPath, startMachineDaemon } from "../../packages/server/src/index.ts";
import { bootOpenMachine, migrateMachineDb } from "./machineBoot.ts";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

describe("register a directory as a project", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("a new canonical path returns a three-letter code and an empty first group", async () => {
		const { runtime } = await boot(cleanups);
		const dir = makeDir("proj-new-");
		cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));

		const body = await register(runtime.baseUrl, dir);
		const canonical = normalizeRegistrationPath(dir);

		expect(body.code).toMatch(/^[A-Z]{3}$/);
		expect(body.name).toBe(basename(canonical));
		expect(body.path).toBe(canonical);
		expect(body.groupId).toBe(`${body.code}-1`);
		expect(body.created).toBe(true);

		const context = await fetch(
			`${runtime.baseUrl}/api/groups/${encodeURIComponent(body.groupId)}/context`,
		);
		expect(context.status).toBe(200);
		expect(await context.json()).toEqual({
			group: { key: body.groupId, name: basename(canonical) },
			toc: [],
			sections: [],
		});
	});

	test("the same canonical path returns the same project and does not create a second group", async () => {
		const { runtime } = await boot(cleanups);
		const dir = makeDir("proj-same-");
		cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));

		const first = await register(runtime.baseUrl, dir);
		const second = await register(runtime.baseUrl, dir);

		expect(second).toEqual({ ...first, created: false });
		const groups = await fetch(`${runtime.baseUrl}/api/groups`);
		expect(groups.status).toBe(200);
		const listed = (await groups.json()) as { groups: { key: string }[] };
		expect(listed.groups.map((group) => group.key)).toEqual([first.groupId]);
	});

	test("a different path returns a different project code and keeps the previous project", async () => {
		const { runtime } = await boot(cleanups);
		const firstDir = makeDir("proj-a-");
		const secondDir = makeDir("proj-b-");
		cleanups.push(async () => {
			rmSync(firstDir, { recursive: true, force: true });
			rmSync(secondDir, { recursive: true, force: true });
		});

		const first = await register(runtime.baseUrl, firstDir);
		const second = await register(runtime.baseUrl, secondDir);

		expect(second.code).toMatch(/^[A-Z]{3}$/);
		expect(second.code).not.toBe(first.code);
		expect(second.groupId).toBe(`${second.code}-1`);
		expect(second.path).not.toBe(first.path);

		const listed = await listProjects(runtime.baseUrl);
		expect(listed).toEqual([
			{ code: first.code, name: first.name, path: first.path },
			{ code: second.code, name: second.name, path: second.path },
		]);
	});

	test("listing projects returns each project's code, name, and path", async () => {
		const { runtime } = await boot(cleanups);
		expect(await listProjects(runtime.baseUrl)).toEqual([]);

		const dir = makeDir("proj-list-");
		cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
		const body = await register(runtime.baseUrl, dir);

		expect(await listProjects(runtime.baseUrl)).toEqual([
			{ code: body.code, name: body.name, path: body.path },
		]);
	});

	test("two spellings of the same directory resolve to one project", async () => {
		const { runtime } = await boot(cleanups);
		const dir = makeDir("proj-spell-");
		const canonical = normalizeRegistrationPath(dir);
		cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));

		const viaTrailingSlash = await register(runtime.baseUrl, `${canonical}/`);
		const viaDot = await register(runtime.baseUrl, join(canonical, "."));
		const viaParent = await register(runtime.baseUrl, join(canonical, "..", basename(canonical)));

		expect(viaTrailingSlash.path).toBe(canonical);
		expect(viaDot).toEqual({ ...viaTrailingSlash, created: false });
		expect(viaParent).toEqual({ ...viaTrailingSlash, created: false });

		const groups = (await (await fetch(`${runtime.baseUrl}/api/groups`)).json()) as {
			groups: { key: string }[];
		};
		expect(groups.groups).toHaveLength(1);
		expect(await listProjects(runtime.baseUrl)).toEqual([
			{
				code: viaTrailingSlash.code,
				name: viaTrailingSlash.name,
				path: canonical,
			},
		]);
	});

	test("a code stays three letters until every code of that length is taken", async () => {
		const { dbPath } = await bootStopped(cleanups);
		fillProjectCodes(dbPath, { except: "QQQ" });
		const { runtime: restarted } = await restartDaemon(dbPath, cleanups);

		const dir = makeDir("proj-last-code-");
		cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
		const body = await register(restarted.baseUrl, dir);

		expect(body.code).toBe("QQQ");
		expect(body.groupId).toBe("QQQ-1");
		const listed = await listProjects(restarted.baseUrl);
		expect(listed.some((project) => project.code === "AAA")).toBe(true);
		expect(listed.some((project) => project.code === "QQQ" && project.path === body.path)).toBe(
			true,
		);
	});

	test("rejects a relative path and an empty path", async () => {
		const { runtime } = await boot(cleanups);
		for (const path of ["relative/path", "   "]) {
			const res = await fetch(`${runtime.baseUrl}/api/projects`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path }),
			});
			expect(res.status).toBe(400);
		}
	});

	test("accepts an absolute path that does not exist on this machine", async () => {
		const { runtime } = await boot(cleanups);
		const ghost = join(tmpdir(), `agent-todo-register-ghost-${Date.now()}`);
		const body = await register(runtime.baseUrl, ghost);
		expect(body.path).toBe(ghost);
		expect(body.created).toBe(true);
	});

	test("the next code grows by one letter when every code of the current length is taken", async () => {
		const { dbPath } = await bootStopped(cleanups);
		fillProjectCodes(dbPath, {});
		const { runtime: restarted } = await restartDaemon(dbPath, cleanups);

		const dir = makeDir("proj-longer-code-");
		cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
		const body = await register(restarted.baseUrl, dir);

		expect(body.code).toMatch(/^[A-Z]{4}$/);
		expect(body.groupId).toBe(`${body.code}-1`);
		const listed = await listProjects(restarted.baseUrl);
		expect(listed.some((project) => project.code === "AAA")).toBe(true);
		expect(listed.some((project) => project.code === body.code && project.path === body.path)).toBe(
			true,
		);
	});
});

type RegisteredProject = {
	code: string;
	name: string;
	path: string;
	groupId: string;
	created: boolean;
};

async function boot(cleanups: Array<() => Promise<void>>) {
	return await bootOpenMachine(cleanups);
}

async function bootStopped(cleanups: Array<() => Promise<void>>) {
	const dir = mkdtempSync(join(tmpdir(), "agent-todo-register-seed-"));
	const dbPath = join(dir, "todo.db");
	await migrateMachineDb(dbPath);
	const runtime = await startMachineDaemon({ dbPath, port: 0 });
	await runtime.stop();
	cleanups.push(async () => {
		rmSync(dir, { recursive: true, force: true });
	});
	return { dbPath, dir };
}

async function restartDaemon(dbPath: string, cleanups: Array<() => Promise<void>>) {
	const runtime = await startMachineDaemon({ dbPath, port: 0 });
	cleanups.push(async () => {
		await runtime.stop();
	});
	return { runtime };
}

function makeDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

async function listProjects(baseUrl: string) {
	const res = await fetch(`${baseUrl}/api/projects`);
	expect(res.status).toBe(200);
	return ((await res.json()) as { projects: RegisteredProject[] }).projects;
}

async function register(baseUrl: string, path: string): Promise<RegisteredProject> {
	const res = await fetch(`${baseUrl}/api/projects`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ path }),
	});
	expect(res.status).toBe(200);
	return (await res.json()) as RegisteredProject;
}

function fillProjectCodes(dbPath: string, opts: { except?: string }) {
	const db = new Database(dbPath);
	const now = new Date().toISOString();
	const insert = db.prepare(
		"INSERT INTO projects (code, name, path, group_seq, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
	);
	db.exec("BEGIN");
	for (let i = 0; i < 26; i++) {
		for (let j = 0; j < 26; j++) {
			for (let k = 0; k < 26; k++) {
				const code = `${LETTERS[i]}${LETTERS[j]}${LETTERS[k]}`;
				if (code === opts.except) continue;
				insert.run(code, code, `seed:${code}`, now, now);
			}
		}
	}
	db.exec("COMMIT");
	db.close();
}
