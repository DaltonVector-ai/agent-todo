import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TaskService } from "../../packages/core/src/index.ts";
import { startTestDaemon } from "../daemon/helpers.ts";

const WORKERS = 30;
const DURATION_MS = Number(process.env.AGENT_TODO_HAMMER_MS ?? 45_000);

function extractTaskId(result: unknown): string | null {
	const text = JSON.stringify(result);
	const m = text.match(/KEY-\d+/);
	return m?.[0] ?? null;
}

describe("daemon concurrency hammer", () => {
	test(
		`${WORKERS} agents hammer task_next without busy or duplicate claims`,
		async () => {
			const env = await startTestDaemon({ toolsets: ["core", "plan"] });
			const tasks = new TaskService(env.store);
			for (let batch = 0; batch < 3; batch++) {
				const items = Array.from({ length: 50 }, (_, i) => ({
					title: `Hammer ${batch * 50 + i}`,
					status: "open" as const,
				}));
				await tasks.create("HAM", items);
			}

			const activeClaims = new Set<string>();
			const errors: string[] = [];
			const endAt = Date.now() + DURATION_MS;

			async function worker(id: number) {
				const client = new Client({ name: `worker-${id}`, version: "0" });
				const transport = new StreamableHTTPClientTransport(new URL(`${env.runtime.baseUrl}/mcp`));
				await client.connect(transport);
				try {
					while (Date.now() < endAt) {
						try {
							const res = await client.callTool({
								name: "task_next",
								arguments: { group: "HAM", agent: `agent-${id}`, claim: true },
							});
							const tid = extractTaskId(res);
							if (tid) {
								if (activeClaims.has(tid)) {
									errors.push(`duplicate claim ${tid} by agent-${id}`);
								} else {
									activeClaims.add(tid);
								}
								await client.callTool({
									name: "task_release",
									arguments: { id: tid, agent: `agent-${id}` },
								});
								activeClaims.delete(tid);
							}
						} catch (e) {
							const msg = e instanceof Error ? e.message : String(e);
							if (/SQLITE_BUSY|database is locked/i.test(msg)) {
								errors.push(msg);
							}
						}
					}
				} finally {
					await client.close();
				}
			}

			await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));

			expect(errors.filter((e) => /SQLITE_BUSY|database is locked/i.test(e))).toHaveLength(0);
			expect(errors.filter((e) => e.startsWith("duplicate"))).toHaveLength(0);

			await env.cleanup();
		},
		DURATION_MS + 60_000,
	);
});
