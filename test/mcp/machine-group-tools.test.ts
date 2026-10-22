import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { normalizeRegistrationPath } from "../../packages/server/src/index.ts";
import { bootOpenMachine } from "../daemon/machineBoot.ts";

describe("machine daemon project and group tools", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("lists projects, isolates groups by project code, and assigns unique group ids", async () => {
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

		const projects = await client.callTool({ name: "project_list", arguments: {} });
		expect(projects.isError).toBeFalsy();
		expect(json(projects)).toEqual({
			projects: [
				{ code: alpha.code, name: alpha.name, path: alpha.path },
				{ code: beta.code, name: beta.name, path: beta.path },
			],
		});

		const alphaGroups = await client.callTool({
			name: "group_list",
			arguments: { project: alpha.code },
		});
		expect(alphaGroups.isError).toBeFalsy();
		expect(json(alphaGroups)).toEqual({
			groups: [{ id: alpha.groupId, name: alpha.name }],
		});

		const betaGroups = await client.callTool({
			name: "group_list",
			arguments: { project: beta.code },
		});
		expect(json(betaGroups)).toEqual({
			groups: [{ id: beta.groupId, name: beta.name }],
		});
		expect(JSON.stringify(json(alphaGroups))).not.toContain(beta.groupId);
		expect(JSON.stringify(json(betaGroups))).not.toContain(alpha.groupId);

		const created = await client.callTool({
			name: "group_create",
			arguments: { project: alpha.code, name: "Api" },
		});
		expect(created.isError).toBeFalsy();
		expect(json(created)).toEqual({ id: `${alpha.code}-2`, name: "Api" });

		const again = await client.callTool({
			name: "group_create",
			arguments: { project: beta.code, name: "Web" },
		});
		expect(json(again)).toEqual({ id: `${beta.code}-2`, name: "Web" });
		expect(`${alpha.code}-2`).not.toBe(`${beta.code}-2`);

		const alphaAfter = json(
			await client.callTool({ name: "group_list", arguments: { project: alpha.code } }),
		) as { groups: Array<{ id: string }> };
		expect(alphaAfter.groups.map((group) => group.id)).toEqual([alpha.groupId, `${alpha.code}-2`]);
		expect(alphaAfter.groups.map((group) => group.id)).not.toContain(`${beta.code}-2`);

		const removed = `${alpha.code}-2`;
		const db = new Database(runtime.dbPath);
		db.run("DELETE FROM groups WHERE key = ?", [removed]);
		db.close();

		const reused = await client.callTool({
			name: "group_create",
			arguments: { project: alpha.code, name: "Replacement" },
		});
		expect(reused.isError).toBeFalsy();
		expect(json(reused)).toEqual({ id: `${alpha.code}-3`, name: "Replacement" });
		expect((json(reused) as { id: string }).id).not.toBe(removed);
	});

	test("reads and writes context by group id and rejects a call that omits its required id", async () => {
		const { runtime } = await bootOpenMachine(cleanups);
		const client = await connect(runtime.baseUrl, cleanups);
		const dir = makeDir("proj-context-");
		cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
		const project = await register(runtime.baseUrl, dir);

		await expectRejected(client, "group_list", {});
		await expectRejected(client, "group_create", { name: "Api" });
		await expectRejected(client, "group_create", { project: project.code });
		await expectRejected(client, "context_get", {});
		await expectRejected(client, "context_update", {
			ops: [{ op: "upsert", slug: "overview", title: "Overview", body: "missing group" }],
		});

		const written = await client.callTool({
			name: "context_update",
			arguments: {
				group: project.groupId,
				ops: [{ op: "upsert", slug: "overview", title: "Overview", body: "ship the api" }],
			},
		});
		expect(written.isError).toBeFalsy();

		const read = await client.callTool({
			name: "context_get",
			arguments: { group: project.groupId, sections: ["overview"], format: "json" },
		});
		expect(read.isError).toBeFalsy();
		expect(text(read)).toContain("ship the api");
		expect(text(read)).toContain(project.groupId);
	});
});

type ToolResult = {
	isError?: boolean;
	content?: unknown;
	structuredContent?: unknown;
};

async function connect(baseUrl: string, cleanups: Array<() => Promise<void>>) {
	const client = new Client({ name: "group-tools-test", version: "0" });
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

async function expectRejected(
	client: Client,
	name: string,
	args: Record<string, unknown>,
): Promise<void> {
	const result = await client.callTool({ name, arguments: args });
	expect(result.isError).toBe(true);
}
