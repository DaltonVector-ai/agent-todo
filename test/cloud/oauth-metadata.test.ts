import { describe, expect, test } from "bun:test";
import { startCloudServer } from "../../packages/server/src/runServer.ts";
import { seedDefaultProject } from "../../packages/store-postgres/src/index.ts";
import { hasDocker, startPostgres } from "../postgres/helpers.ts";

const docker = await hasDocker();

describe.skipIf(!docker)("OAuth metadata", () => {
	test("authorization server metadata is exposed", async () => {
		const pg = await startPostgres();
		await seedDefaultProject(pg.databaseUrl);
		process.env.DATABASE_URL = pg.databaseUrl;
		const server = await startCloudServer({ port: 0, databaseUrl: pg.databaseUrl });
		const res = await fetch(`${server.baseUrl}/.well-known/oauth-authorization-server`);
		expect(res.ok).toBe(true);
		const body = (await res.json()) as { token_endpoint?: string };
		expect(body.token_endpoint).toContain("/oauth/token");
		await server.stop();
		await pg.stop();
	});
});
