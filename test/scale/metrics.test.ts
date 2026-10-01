import { describe, expect, test } from "bun:test";
import { generateApiToken, insertApiToken } from "../../packages/server/src/auth/apiTokens.ts";
import { startCloudServer } from "../../packages/server/src/runServer.ts";
import { seedDefaultProject } from "../../packages/store-postgres/src/index.ts";
import { hasDocker, startPostgres } from "../postgres/helpers.ts";

const docker = await hasDocker();

describe.skipIf(!docker)("observability", () => {
	test("/metrics exposes prometheus text", async () => {
		const pg = await startPostgres();
		const { projectPk } = await seedDefaultProject(pg.databaseUrl, {
			orgSlug: "metrics",
			projectSlug: "demo",
		});
		const { token, hash, pk } = generateApiToken();
		const server = await startCloudServer({ port: 0, databaseUrl: pg.databaseUrl });
		await insertApiToken(server.pool, {
			pk,
			projectPk,
			name: "metrics",
			hash,
			toolsetCeiling: "core",
		});

		const res = await fetch(`${server.baseUrl}/metrics`);
		expect(res.ok).toBe(true);
		const body = await res.text();
		expect(body).toContain("agent_todo_tool_duration_ms");

		const health = await fetch(`${server.baseUrl}/health`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(health.ok).toBe(true);

		await server.stop();
		await pg.stop();
	});
});
