import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GroupService } from "../../packages/core/src/index.ts";
import { createMcpServer } from "../../packages/mcp/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

type JsonSchema = {
	description?: string;
	type?: string | string[];
	properties?: Record<string, JsonSchema>;
	items?: JsonSchema | JsonSchema[];
	anyOf?: JsonSchema[];
	oneOf?: JsonSchema[];
	allOf?: JsonSchema[];
	$ref?: string;
	$defs?: Record<string, JsonSchema>;
	definitions?: Record<string, JsonSchema>;
};

async function planClient() {
	const dir = mkdtempSync(join(tmpdir(), "agent-todo-binding-"));
	const store = await openStore({ path: join(dir, "todo.db") });
	const groups = new GroupService(store);
	await groups.create({ key: "AUTH", name: "Auth" });

	const server = createMcpServer({ store, toolsets: ["core", "plan"], defaultAgent: "planner" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: "test", version: "0" });
	await client.connect(clientTransport);

	return {
		client,
		cleanup: async () => {
			await client.close();
			await server.close();
			await store.close();
		},
	};
}

function text(result: { content?: unknown }): string {
	return ((result.content as Array<{ text?: string }>) ?? []).map((b) => b.text ?? "").join("\n");
}

function wordCount(value: string): number {
	return value.trim().split(/\s+/).filter(Boolean).length;
}

function resolveSchema(root: JsonSchema, schema: JsonSchema): JsonSchema {
	if (!schema.$ref) return schema;
	const name = schema.$ref.replace(/^#\/(?:\$defs|definitions)\//, "");
	const target = root.$defs?.[name] ?? root.definitions?.[name];
	return target ? resolveSchema(root, target) : schema;
}

function findProperties(root: JsonSchema, schema: JsonSchema, name: string): JsonSchema[] {
	const node = resolveSchema(root, schema);
	const found: JsonSchema[] = [];
	if (node.properties?.[name]) found.push(resolveSchema(root, node.properties[name]));
	const nested = [
		...(Array.isArray(node.items) ? node.items : node.items ? [node.items] : []),
		...(node.anyOf ?? []),
		...(node.oneOf ?? []),
		...(node.allOf ?? []),
		...Object.values(node.properties ?? {}),
	];
	for (const child of nested) found.push(...findProperties(root, child, name));
	return found;
}

function property(schema: JsonSchema, path: string[]): JsonSchema {
	let node = schema;
	for (const key of path) {
		if (key === "items") {
			if (!node.items || Array.isArray(node.items)) {
				throw new Error(`missing schema path ${path.join(".")}`);
			}
			node = node.items;
			continue;
		}
		const next = node.properties?.[key];
		if (!next) throw new Error(`missing schema path ${path.join(".")}`);
		node = next;
	}
	return node;
}

function tocSegments(body: string): string[] {
	const line = body.split("\n").find((entry) => entry.includes(" context · "));
	if (!line) throw new Error(`missing context TOC in:\n${body}`);
	return line.split(" · ").slice(1);
}

describe("tag to context binding published on MCP tools", () => {
	test("listTools and context index publish the binding", async () => {
		const { client, cleanup } = await planClient();
		try {
			const tools = await client.listTools();
			const byName = Object.fromEntries(tools.tools.map((tool) => [tool.name, tool]));
			const create = byName.task_create;
			const update = byName.task_update;
			const next = byName.task_next;
			const contextGet = byName.context_get;
			const contextUpdate = byName.context_update;
			if (!create || !update || !next || !contextGet || !contextUpdate) {
				throw new Error("missing tools");
			}

			expect(create.description).toMatch(/tags select context sections/);
			expect(
				create.description
					?.split(/[.!?]+/)
					.map((part) => part.trim())
					.filter(Boolean),
			).toHaveLength(1);

			const createSchema = create.inputSchema as JsonSchema;
			const updateSchema = update.inputSchema as JsonSchema;
			const nextSchema = next.inputSchema as JsonSchema;
			const contextGetSchema = contextGet.inputSchema as JsonSchema;
			const contextUpdateSchema = contextUpdate.inputSchema as JsonSchema;

			const createTags = property(createSchema, ["tasks", "items", "tags"]).description ?? "";
			const addTags = property(updateSchema, ["add", "tags"]).description ?? "";
			const removeTags = property(updateSchema, ["remove", "tags"]).description ?? "";
			const nextTags = property(nextSchema, ["tags"]).description ?? "";
			const forTask = property(contextGetSchema, ["for_task"]).description ?? "";
			const alwaysInclude = findProperties(
				contextUpdateSchema,
				contextUpdateSchema,
				"always_include",
			);
			const appliesTo = findProperties(contextUpdateSchema, contextUpdateSchema, "applies_to");

			expect(createTags).toContain("applies_to");
			expect(addTags).toBe(createTags);
			expect(removeTags).toBe(createTags);
			expect(nextTags.toLowerCase()).toMatch(/claim/);
			expect(nextTags.toLowerCase()).toMatch(/filter/);
			expect(nextTags.toLowerCase()).not.toContain("attach");
			expect(nextTags.toLowerCase()).not.toContain("context");
			expect(forTask).toContain("applies_to");
			expect(forTask.toLowerCase()).toContain("always-included");
			expect(alwaysInclude.length).toBeGreaterThan(0);
			expect(appliesTo.length).toBeGreaterThan(0);
			expect(alwaysInclude[0]?.type).toBe("boolean");
			expect(appliesTo[0]?.type).toBe("array");

			for (const description of [
				createTags,
				addTags,
				removeTags,
				nextTags,
				forTask,
				alwaysInclude[0]?.description ?? "",
				appliesTo[0]?.description ?? "",
			]) {
				expect(description.length).toBeGreaterThan(0);
				expect(wordCount(description)).toBeLessThanOrEqual(10);
			}

			const written = await client.callTool({
				name: "context_update",
				arguments: {
					group: "AUTH",
					ops: [
						{
							op: "upsert",
							slug: "billing",
							title: "Billing",
							always_include: true,
							applies_to: ["invoice"],
						},
					],
				},
			});
			expect(written.isError).toBeFalsy();

			const index = await client.callTool({
				name: "context_get",
				arguments: { group: "AUTH" },
			});
			const segments = tocSegments(text(index));
			expect(segments).toContain("conventions 0t [code]");
			expect(segments).toContain("testing 0t [test]");
			expect(segments).toContain("deploy 0t [deploy]");
			expect(segments).toContain("overview 0t*");
			expect(segments).toContain("architecture 0t");
			expect(segments).toContain("billing 0t* [invoice]");
			expect(text(index)).not.toContain("[]");

			const indexJson = JSON.parse(
				text(
					await client.callTool({
						name: "context_get",
						arguments: { group: "AUTH", format: "json" },
					}),
				),
			) as { toc: Array<Record<string, unknown>> };
			const bySlug = Object.fromEntries(indexJson.toc.map((entry) => [entry.slug, entry]));
			expect(bySlug.conventions?.applies_to).toEqual(["code"]);
			expect(bySlug.architecture?.applies_to).toEqual([]);
			expect(bySlug.overview?.alwaysInclude).toBe(true);
			expect(bySlug.billing?.applies_to).toEqual(["invoice"]);
			expect(bySlug.billing?.alwaysInclude).toBe(true);
			expect(bySlug.conventions).not.toHaveProperty("appliesTo");

			const groupText = text(
				await client.callTool({
					name: "group_get",
					arguments: { key: "AUTH" },
				}),
			);
			expect(tocSegments(groupText)).toEqual(segments);

			const groupJson = JSON.parse(
				text(
					await client.callTool({
						name: "group_get",
						arguments: { key: "AUTH", format: "json" },
					}),
				),
			) as { toc: Array<Record<string, unknown>> };
			const groupBySlug = Object.fromEntries(groupJson.toc.map((entry) => [entry.slug, entry]));
			expect(groupBySlug.conventions?.applies_to).toEqual(["code"]);
			expect(groupBySlug.billing?.applies_to).toEqual(["invoice"]);
			expect(groupBySlug.billing?.alwaysInclude).toBe(true);
			expect(groupBySlug.architecture?.applies_to).toEqual([]);
		} finally {
			await cleanup();
		}
	});
});
