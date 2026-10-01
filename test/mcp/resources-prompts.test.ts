import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GroupService } from "../../packages/core/src/index.ts";
import { createMcpServer } from "../../packages/mcp/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

describe("MCP resources and prompts", () => {
	test("resources readable and prompts listable", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-rp-"));
		const store = await openStore({ path: join(dir, "todo.db") });
		const groups = new GroupService(store);
		await groups.create({ key: "WEB", name: "Web" });

		const server = createMcpServer({ store, toolsets: ["core", "plan"] });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		const client = new Client({ name: "test", version: "0" });
		await client.connect(clientTransport);

		const resources = await client.listResources();
		expect(resources.resources.some((r) => r.uri === "todo://groups")).toBe(true);

		const groupsRes = await client.readResource({ uri: "todo://groups" });
		const groupsText = groupsRes.contents[0]?.text ?? "";
		expect(groupsText).toContain("WEB");

		const toc = await client.readResource({ uri: "todo://group/WEB/context" });
		expect(toc.contents[0]?.text).toContain("context ·");

		const prompts = await client.listPrompts();
		const names = prompts.prompts.map((p) => p.name);
		expect(names).toEqual(expect.arrayContaining(["start_work", "compact", "handoff"]));

		const started = await client.getPrompt({ name: "start_work", arguments: { group: "WEB" } });
		expect(started.messages[0]?.content).toBeDefined();

		await client.close();
		await server.close();
		await store.close();
	});
});
