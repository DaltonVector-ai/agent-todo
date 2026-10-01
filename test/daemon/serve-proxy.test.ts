import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TaskService } from "../../packages/core/src/index.ts";
import { startTestDaemon } from "./helpers.ts";

describe("daemon MCP", () => {
	test("task_list via HTTP MCP", async () => {
		const env = await startTestDaemon();
		const tasks = new TaskService(env.store);
		await tasks.create("HAM", [{ title: "Listed", status: "todo" }]);

		const client = new Client({ name: "test", version: "0" });
		const transport = new StreamableHTTPClientTransport(new URL(`${env.runtime.baseUrl}/mcp`));
		await client.connect(transport);

		const listed = await client.callTool({ name: "task_list", arguments: { group: "HAM" } });
		expect(JSON.stringify(listed)).toContain("Listed");

		await client.close();
		await env.cleanup();
	});
});
