import { describe, expect, test } from "bun:test";
import { generateApiToken, insertApiToken } from "../../packages/server/src/auth/apiTokens.ts";
import { emitProjectNotify } from "../../packages/server/src/fanout/notify.ts";
import { startCloudServer } from "../../packages/server/src/runServer.ts";
import { seedDefaultProject } from "../../packages/store-postgres/src/index.ts";
import { hasDocker, startPostgres } from "../postgres/helpers.ts";

const docker = await hasDocker();

describe.skipIf(!docker)("LISTEN/NOTIFY fan-out", () => {
	test("NOTIFY bumps SSE stream without local write", async () => {
		const pg = await startPostgres();
		const { projectPk } = await seedDefaultProject(pg.databaseUrl, {
			orgSlug: "fanout",
			projectSlug: "demo",
		});
		const { token, hash, pk } = generateApiToken();
		const server = await startCloudServer({ port: 0, databaseUrl: pg.databaseUrl });
		await insertApiToken(server.pool, {
			pk,
			projectPk,
			name: "fanout",
			hash,
			toolsetCeiling: "core",
		});

		let seen = false;
		const ac = new AbortController();
		const esTask = (async () => {
			const res = await fetch(`${server.baseUrl}/api/events/stream`, {
				headers: { Authorization: `Bearer ${token}` },
				signal: ac.signal,
			});
			const reader = res.body?.getReader();
			if (!reader) throw new Error("no body");
			const dec = new TextDecoder();
			const start = Date.now();
			while (Date.now() - start < 5000) {
				const { value, done } = await reader.read();
				if (done) break;
				if (dec.decode(value).includes('"rev"')) {
					seen = true;
					break;
				}
			}
		})();

		await new Promise((r) => setTimeout(r, 200));
		await emitProjectNotify(server.pool, { projectPk, groupKey: "MAIN", rev: 1 });

		await esTask;
		ac.abort();
		expect(seen).toBe(true);

		await server.stop();
		await pg.stop();
	});
});
