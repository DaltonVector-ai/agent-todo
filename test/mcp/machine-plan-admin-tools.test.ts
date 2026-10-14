import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startMachineDaemon } from "../../packages/server/src/index.ts";

describe("machine daemon plan and admin tools", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("uses group and task ids and rejects a call that omits its required id", async () => {
		const runtime = await boot(cleanups);
		const client = await connect(runtime.baseUrl, cleanups);
		const alphaDir = makeDir("proj-alpha-");
		const betaDir = makeDir("proj-beta-");
		cleanups.push(async () => {
			rmSync(alphaDir, { recursive: true, force: true });
			rmSync(betaDir, { recursive: true, force: true });
		});

		const alpha = await register(runtime.baseUrl, alphaDir);
		const beta = await register(runtime.baseUrl, betaDir);

		await expectRejected(client, "group_list", {});
		await expectRejected(client, "group_create", { name: "Api" });
		await expectRejected(client, "group_update", { v: 1, set: { summary: "missing id" } });
		await expectRejected(client, "group_get", {});
		await expectRejected(client, "context_import", { markdown: "## Notes\nmissing group" });
		await expectRejected(client, "context_export", { flavor: "stub" });
		await expectRejected(client, "comment_compact", { summary_body: "missing task" });
		await expectRejected(client, "task_claim", {});
		await expectRejected(client, "task_release", {});
		await expectRejected(client, "task_move", { group: beta.groupId });
		await expectRejected(client, "task_move", { id: `${alpha.groupId}-1` });
		await expectRejected(client, "task_archive", { reason: "missing id" });
		await expectRejected(client, "group_archive", {});
		await expectRejected(client, "history", {});

		const api = json(
			await client.callTool({
				name: "group_create",
				arguments: { project: alpha.code, name: "Api" },
			}),
		) as { id: string };
		expect(api.id).toBe(`${alpha.code}-2`);

		const updated = await client.callTool({
			name: "group_update",
			arguments: { key: alpha.groupId, v: 1, set: { summary: "alpha only" } },
		});
		expect(updated.isError).toBeFalsy();
		expect(text(updated)).toContain(alpha.groupId);
		expect(text(updated)).not.toContain(beta.groupId);

		const alphaGroup = text(
			await client.callTool({
				name: "group_get",
				arguments: { key: alpha.groupId },
			}),
		);
		expect(alphaGroup).toContain(alpha.groupId);
		expect(alphaGroup).toContain("alpha only");
		expect(alphaGroup).not.toContain(beta.groupId);
		expect(alphaGroup).not.toContain("Beta secret");

		const imported = await client.callTool({
			name: "context_import",
			arguments: {
				group: alpha.groupId,
				markdown: "## Notes\nalpha context",
				mode: "merge",
			},
		});
		expect(imported.isError).toBeFalsy();
		expect(text(imported)).toContain(alpha.groupId);

		await client.callTool({
			name: "context_import",
			arguments: {
				group: beta.groupId,
				markdown: "## Notes\nbeta context secret",
				mode: "merge",
			},
		});

		const exported = text(
			await client.callTool({
				name: "context_export",
				arguments: { group: alpha.groupId, flavor: "plain" },
			}),
		);
		expect(exported).toContain("alpha context");
		expect(exported).not.toContain("beta context secret");
		expect(exported).not.toContain(beta.groupId);

		const alphaTasks = json(
			await client.callTool({
				name: "task_create",
				arguments: {
					group: alpha.groupId,
					tasks: [{ title: "Alpha visible" }, { title: "Alpha move" }],
				},
			}),
		) as { tasks: Array<{ id: string; v: number }> };
		const betaTasks = json(
			await client.callTool({
				name: "task_create",
				arguments: {
					group: beta.groupId,
					tasks: [{ title: "Beta secret" }],
				},
			}),
		) as { tasks: Array<{ id: string }> };
		const visible = alphaTasks.tasks[0];
		const movable = alphaTasks.tasks[1];
		const secret = betaTasks.tasks[0];
		if (!visible || !movable || !secret) throw new Error("missing task");
		expect(visible.id).toBe(`${alpha.groupId}-1`);
		expect(movable.id).toBe(`${alpha.groupId}-2`);
		expect(secret.id).toBe(`${beta.groupId}-1`);

		const opened = writeAck(
			await client.callTool({
				name: "task_status",
				arguments: { id: visible.id, v: visible.v, to: "open" },
			}),
		);
		const claimed = json(
			await client.callTool({
				name: "task_claim",
				arguments: { id: visible.id },
			}),
		) as { id: string; claim_expires: string };
		expect(claimed.id).toBe(visible.id);
		expect(claimed.claim_expires).toBeTruthy();
		expect(JSON.stringify(claimed)).not.toContain(secret.id);
		expect(JSON.stringify(claimed)).not.toContain("Beta secret");

		const noted = await client.callTool({
			name: "comment_add",
			arguments: { task: movable.id, body: "alpha note" },
		});
		expect(noted.isError).toBeFalsy();
		const compacted = json(
			await client.callTool({
				name: "comment_compact",
				arguments: { task: movable.id, summary_body: "alpha compacted" },
			}),
		) as { id: string; hidden: number };
		expect(compacted.hidden).toBeGreaterThan(0);
		expect(JSON.stringify(compacted)).not.toContain(secret.id);
		expect(JSON.stringify(compacted)).not.toContain("Beta secret");

		const moved = json(
			await client.callTool({
				name: "task_move",
				arguments: { id: movable.id, group: api.id },
			}),
		) as { id: string; group: string };
		expect(moved).toEqual({ id: movable.id, group: api.id });
		expect(moved.group).not.toBe(beta.groupId);

		const archived = text(
			await client.callTool({
				name: "task_archive",
				arguments: { id: visible.id, reason: "done" },
			}),
		);
		expect(archived).toContain(visible.id);
		expect(archived).not.toContain(secret.id);
		expect(archived).not.toContain("Beta secret");

		const history = text(
			await client.callTool({
				name: "history",
				arguments: { id: visible.id },
			}),
		);
		expect(history).toContain(visible.id);
		expect(history).toContain("archive");
		expect(history).not.toContain(secret.id);
		expect(history).not.toContain(beta.groupId);
		expect(history).not.toContain("Beta secret");

		const groupHistory = text(
			await client.callTool({
				name: "history",
				arguments: { id: alpha.groupId },
			}),
		);
		expect(groupHistory).toContain(alpha.groupId);
		expect(groupHistory).not.toContain(secret.id);
		expect(groupHistory).not.toContain(beta.groupId);

		const archivedGroup = text(
			await client.callTool({
				name: "group_archive",
				arguments: { key: api.id },
			}),
		);
		expect(archivedGroup).toContain(api.id);
		expect(archivedGroup).not.toContain(beta.groupId);

		expect(opened.status).toBe("open");
	});
});

type ToolResult = {
	isError?: boolean;
	content?: unknown;
	structuredContent?: unknown;
};

async function boot(cleanups: Array<() => Promise<void>>) {
	const dir = mkdtempSync(join(tmpdir(), "agent-todo-plan-admin-"));
	const dbPath = join(dir, "todo.db");
	const runtime = await startMachineDaemon({ dbPath, port: 0 });
	cleanups.push(async () => {
		await runtime.stop();
		rmSync(dir, { recursive: true, force: true });
	});
	return runtime;
}

async function connect(baseUrl: string, cleanups: Array<() => Promise<void>>) {
	const client = new Client({ name: "plan-admin-tools-test", version: "0" });
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
	expect(body.path).toBe(realpathSync(path));
	return body;
}

function text(result: ToolResult): string {
	return ((result.content as Array<{ text?: string }>) ?? [])
		.map((block) => block.text ?? "")
		.join("\n");
}

function json(result: ToolResult): unknown {
	expect(result.isError).toBeFalsy();
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
