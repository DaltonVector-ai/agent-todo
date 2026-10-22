import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { normalizeRegistrationPath } from "../../packages/server/src/index.ts";
import { bootOpenMachine } from "../daemon/machineBoot.ts";

describe("machine daemon task tools", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("creates, lists, reads, updates, comments, and releases tasks by id", async () => {
		const { runtime } = await bootOpenMachine(cleanups);
		const client = await connect(runtime.baseUrl, cleanups);
		const alphaDir = makeDir("proj-alpha-");
		const betaDir = makeDir("proj-beta-");
		cleanups.push(async () => {
			rmSync(alphaDir, { recursive: true, force: true });
			rmSync(betaDir, { recursive: true, force: true });
		});

		const alpha = await register(runtime.baseUrl, alphaDir);
		const beta = await register(runtime.baseUrl, betaDir);
		const alphaApi = json(
			await client.callTool({
				name: "group_create",
				arguments: { project: alpha.code, name: "Api" },
			}),
		) as { id: string };

		await expectRejected(client, "task_create", { tasks: [{ title: "missing group" }] });
		await expectRejected(client, "task_list", {});
		await expectRejected(client, "task_next", {});
		await expectRejected(client, "task_get", {});
		await expectRejected(client, "task_update", { v: 1, set: { title: "missing id" } });
		await expectRejected(client, "comment_add", { body: "missing task" });
		await expectRejected(client, "comment_list", {});
		await expectRejected(client, "task_release", {});

		const created = json(
			await client.callTool({
				name: "task_create",
				arguments: {
					group: alpha.groupId,
					tasks: [{ title: "Alpha one" }, { title: "Alpha two" }],
				},
			}),
		) as { tasks: Array<{ id: string; v: number }> };
		expect(created.tasks.map((task) => task.id)).toEqual([
			`${alpha.groupId}-1`,
			`${alpha.groupId}-2`,
		]);

		const apiTask = json(
			await client.callTool({
				name: "task_create",
				arguments: {
					group: alphaApi.id,
					tasks: [{ title: "Api only" }],
				},
			}),
		) as { tasks: Array<{ id: string }> };
		expect(apiTask.tasks[0]?.id).toBe(`${alphaApi.id}-1`);

		const betaCreated = json(
			await client.callTool({
				name: "task_create",
				arguments: {
					group: beta.groupId,
					tasks: [{ title: "Beta secret" }],
				},
			}),
		) as { tasks: Array<{ id: string; v: number }> };
		const betaId = betaCreated.tasks[0]?.id;
		expect(betaId).toBe(`${beta.groupId}-1`);

		const alphaList = text(
			await client.callTool({
				name: "task_list",
				arguments: { group: alpha.groupId },
			}),
		);
		expect(alphaList).toContain(`${alpha.groupId}-1`);
		expect(alphaList).toContain(`${alpha.groupId}-2`);
		expect(alphaList).toContain("Alpha one");
		expect(alphaList).not.toContain("Api only");
		expect(alphaList).not.toContain("Beta secret");
		expect(alphaList).not.toContain(`${beta.groupId}-1`);
		expect(alphaList).not.toContain(`${alphaApi.id}-1`);

		const removed = `${alpha.groupId}-1`;
		const db = new Database(runtime.dbPath);
		db.run("DELETE FROM tasks WHERE id = ?", [removed]);
		db.close();

		const reused = json(
			await client.callTool({
				name: "task_create",
				arguments: {
					group: alpha.groupId,
					tasks: [{ title: "Alpha three" }],
				},
			}),
		) as { tasks: Array<{ id: string; v: number }> };
		expect(reused.tasks[0]?.id).toBe(`${alpha.groupId}-3`);
		expect(reused.tasks[0]?.id).not.toBe(removed);

		const target = created.tasks[1];
		if (!target || !betaId) throw new Error("missing task");

		const updated = await client.callTool({
			name: "task_update",
			arguments: { id: target.id, v: target.v, set: { title: "Alpha renamed" } },
		});
		expect(updated.isError).toBeFalsy();

		const read = text(
			await client.callTool({
				name: "task_get",
				arguments: { id: target.id, view: "brief" },
			}),
		);
		expect(read).toContain(target.id);
		expect(read).toContain("Alpha renamed");
		expect(read).not.toContain("Beta secret");
		expect(read).not.toContain(betaId);

		const comment = await client.callTool({
			name: "comment_add",
			arguments: { task: target.id, body: "alpha note" },
		});
		expect(comment.isError).toBeFalsy();

		const comments = text(
			await client.callTool({
				name: "comment_list",
				arguments: { task: target.id, view: "full" },
			}),
		);
		expect(comments).toContain("alpha note");
		expect(comments).not.toContain("Beta secret");

		const opened = writeAck(
			await client.callTool({
				name: "task_status",
				arguments: { id: target.id, v: target.v + 1, to: "open" },
			}),
		);
		expect(opened).toMatchObject({ id: target.id, status: "open" });
		const claimed = writeAck(
			await client.callTool({
				name: "task_status",
				arguments: { id: target.id, v: opened.v, to: "inprogress" },
			}),
		);
		expect(claimed.status).toBe("inprogress");

		const released = json(
			await client.callTool({
				name: "task_release",
				arguments: { id: target.id },
			}),
		) as { id: string; status: string };
		expect(released).toEqual({ id: target.id, status: "open" });

		const afterRelease = text(
			await client.callTool({
				name: "task_get",
				arguments: { id: target.id, view: "full", format: "json" },
			}),
		);
		expect(afterRelease).toContain('"status":"open"');
		expect(afterRelease).not.toContain("Beta secret");
	});

	test("task_next with project code claims the highest-priority ready task across groups", async () => {
		const { runtime } = await bootOpenMachine(cleanups);
		const client = await connect(runtime.baseUrl, cleanups);
		const alphaDir = makeDir("proj-priority-");
		const betaDir = makeDir("proj-other-");
		cleanups.push(async () => {
			rmSync(alphaDir, { recursive: true, force: true });
			rmSync(betaDir, { recursive: true, force: true });
		});

		const alpha = await register(runtime.baseUrl, alphaDir);
		const beta = await register(runtime.baseUrl, betaDir);
		const feature = json(
			await client.callTool({
				name: "group_create",
				arguments: { project: alpha.code, name: "Feature" },
			}),
		) as { id: string };
		const archivedGroup = json(
			await client.callTool({
				name: "group_create",
				arguments: { project: alpha.code, name: "Retired" },
			}),
		) as { id: string };

		await createOpenTask(client, alpha.groupId, "Low priority", 2);
		await createOpenTask(client, feature.id, "High priority", 0);
		await createOpenTask(client, archivedGroup.id, "Archived group task", 0);
		await createOpenTask(client, beta.groupId, "Other project", 0);

		const archived = await client.callTool({
			name: "group_archive",
			arguments: { key: archivedGroup.id },
		});
		expect(archived.isError).toBeFalsy();

		await expectRejected(client, "task_next", {});
		await expectRejected(client, "task_next", { project: "NOPE" });
		await expectRejected(client, "task_next", {
			project: alpha.code,
			group: beta.groupId,
		});

		const scoped = text(
			await client.callTool({
				name: "task_next",
				arguments: { group: alpha.groupId },
			}),
		);
		expect(scoped).toContain(`${alpha.groupId}-1`);

		const claimed = text(
			await client.callTool({
				name: "task_next",
				arguments: { project: alpha.code },
			}),
		);
		expect(claimed).toContain(`${feature.id}-1`);
		expect(claimed).not.toContain(`${archivedGroup.id}-1`);
		expect(claimed).not.toContain(`${beta.groupId}-1`);

		const emptyDir = makeDir("proj-empty-");
		cleanups.push(async () => rmSync(emptyDir, { recursive: true, force: true }));
		const emptyProject = await register(runtime.baseUrl, emptyDir);
		const empty = await client.callTool({
			name: "task_next",
			arguments: { project: emptyProject.code, claim: false },
		});
		expect(empty.isError).toBeFalsy();
		expect(text(empty)).toContain("none");

		const docs = await client.callTool({ name: "docs", arguments: {} });
		expect(docs.isError).toBeFalsy();
		expect(text(docs)).toContain("shared context layer");
		expect(text(docs)).toContain("context_get");
		const tools = await client.listTools();
		const docsTool = tools.tools.find((tool) => tool.name === "docs");
		expect(docsTool?.description).toBe("Return the fixed agent-todo usage guide.");
		expect(
			docsTool?.description
				?.split(/[.!?]+/)
				.map((part) => part.trim())
				.filter(Boolean),
		).toHaveLength(1);
		const taskNext = tools.tools.find((tool) => tool.name === "task_next");
		expect(taskNext?.description).toContain("project");
		expect(taskNext?.description).toContain("group");
	});
});

async function createOpenTask(
	client: Client,
	group: string,
	title: string,
	priority: number,
): Promise<string> {
	const createResult = await client.callTool({
		name: "task_create",
		arguments: {
			group,
			tasks: [{ title, priority }],
		},
	});
	if (createResult.isError) {
		throw new Error(`task_create failed for ${group}: ${text(createResult)}`);
	}
	const created = json(createResult) as { tasks: Array<{ id: string; v: number }> };
	const task = created.tasks[0];
	if (!task) throw new Error("missing created task");
	const opened = await client.callTool({
		name: "task_status",
		arguments: { id: task.id, v: task.v, to: "open" },
	});
	expect(opened.isError).toBeFalsy();
	return task.id;
}

type ToolResult = {
	isError?: boolean;
	content?: unknown;
	structuredContent?: unknown;
};

async function connect(baseUrl: string, cleanups: Array<() => Promise<void>>) {
	const client = new Client({ name: "task-tools-test", version: "0" });
	const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
	await client.connect(transport);
	cleanups.push(async () => {
		await client.close();
	});
	return client;
}

function makeDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

async function register(baseUrl: string, path: string) {
	const res = await fetch(`${baseUrl}/api/projects`, {
		method: "POST",
		headers: { "content-type": "application/json" },
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
	expect(body.path).toBe(normalizeRegistrationPath(path));
	return body;
}

function text(result: ToolResult): string {
	return ((result.content as Array<{ text?: string }>) ?? [])
		.map((block) => block.text ?? "")
		.join("\n");
}

function json(result: ToolResult): unknown {
	if (result.structuredContent !== undefined) return result.structuredContent;
	return JSON.parse(text(result));
}

function writeAck(result: ToolResult): { id: string; v?: number; status?: string } {
	expect(result.isError).toBeFalsy();
	const line = text(result).trim().split("\n")[0] ?? "";
	const [id, ...parts] = line.split(" ");
	const ack: { id: string; v?: number; status?: string } = { id: id ?? "" };
	for (const part of parts) {
		if (part.startsWith("v=")) ack.v = Number(part.slice(2));
		else if (part.startsWith("status=")) ack.status = part.slice("status=".length);
	}
	return ack;
}

async function expectRejected(
	client: Client,
	name: string,
	args: Record<string, unknown>,
): Promise<void> {
	const result = await client.callTool({ name, arguments: args });
	expect(result.isError).toBe(true);
}
