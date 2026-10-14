import { describe, expect, test } from "bun:test";
import { generateApiToken, insertApiToken } from "../../packages/server/src/auth/apiTokens.ts";
import { startCloudServer } from "../../packages/server/src/runServer.ts";
import { openStore, seedDefaultProject } from "../../packages/store-postgres/src/index.ts";
import { hasDocker, startPostgres } from "../postgres/helpers.ts";

const docker = await hasDocker();

async function mcpTool(
	baseUrl: string,
	token: string,
	name: string,
	args: Record<string, unknown>,
): Promise<{ status: number }> {
	const res = await fetch(`${baseUrl}/mcp`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json, text/event-stream",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name, arguments: args },
		}),
	});
	return { status: res.status };
}

describe.skipIf(!docker)("k6 smoke (scaled down)", () => {
	test("concurrent core tool calls succeed and claims stay within the worker count", async () => {
		const pg = await startPostgres();
		const { projectPk } = await seedDefaultProject(pg.databaseUrl, {
			orgSlug: "k6",
			projectSlug: "demo",
		});
		const store = await openStore({ databaseUrl: pg.databaseUrl, projectPk });
		await store.groups.create({ key: "LOAD", name: "Load" });
		for (let i = 0; i < 200; i++) {
			await store.tasks.create({
				groupKey: "LOAD",
				title: `Task ${i}`,
				status: "open",
			});
		}
		await store.close();

		const { token, hash, pk } = generateApiToken();
		const server = await startCloudServer({
			port: 0,
			databaseUrl: pg.databaseUrl,
			jobsEnabled: false,
		});
		await insertApiToken(server.pool, {
			pk,
			projectPk,
			name: "k6",
			hash,
			toolsetCeiling: "core",
		});

		const workers = Array.from({ length: 40 }, async (_, i) => {
			const list = await mcpTool(server.baseUrl, token, "task_list", {
				group: "LOAD",
				limit: 20,
			});
			expect(list.status).toBe(200);
			const next = await mcpTool(server.baseUrl, token, "task_next", {
				group: "LOAD",
				agent: `agent-${i}`,
				claim: true,
			});
			expect(next.status).toBe(200);
		});
		await Promise.all(workers);

		const claimed = await server.pool.query<{ cnt: string }>(
			`SELECT COUNT(*)::text AS cnt FROM tasks
       WHERE project_pk = $1 AND status = 'inprogress'`,
			[projectPk],
		);
		const inProgress = Number(claimed.rows[0]?.cnt ?? 0);
		expect(inProgress).toBeLessThanOrEqual(40);

		await server.stop();
		await pg.stop();
	});
});
