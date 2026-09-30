import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApiToken, insertApiToken } from "../../packages/server/src/auth/apiTokens.ts";
import { startCloudServer } from "../../packages/server/src/runServer.ts";
import { buildPushPayload } from "../../packages/server/src/sync/payload.ts";
import { openStore, seedDefaultProject } from "../../packages/store-postgres/src/index.ts";
import { openStore as openSqlite } from "../../packages/store-sqlite/src/index.ts";
import { hasDocker, startPostgres } from "../postgres/helpers.ts";

const docker = await hasDocker();

describe.skipIf(!docker)("cloud push preserves IDs", () => {
	test("500 tasks keep ids and comments", async () => {
		const pg = await startPostgres();
		const { projectPk } = await seedDefaultProject(pg.databaseUrl, {
			orgSlug: "push",
			projectSlug: "demo",
		});

		const dir = mkdtempSync(join(tmpdir(), "agent-todo-push-"));
		const sqlite = await openSqlite({ path: join(dir, "todo.db") });
		await sqlite.groups.create({ key: "LOAD", name: "Load" });
		for (let i = 0; i < 500; i++) {
			const t = await sqlite.tasks.create({
				groupKey: "LOAD",
				title: `Task ${i}`,
				status: "open",
			});
			if (i === 0) {
				await sqlite.comments.create({
					taskId: t.id,
					author: "test",
					kind: "note",
					body: "first-comment",
				});
			}
		}
		const payload = await buildPushPayload(sqlite);
		expect(payload.tasks.length).toBe(500);
		await sqlite.close();

		const { token, hash, pk } = generateApiToken();
		const server = await startCloudServer({ port: 0, databaseUrl: pg.databaseUrl });
		await insertApiToken(server.pool, {
			pk,
			projectPk,
			name: "push",
			hash,
			toolsetCeiling: "admin",
		});

		const res = await fetch(`${server.baseUrl}/api/sync/push`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});
		expect(res.ok).toBe(true);

		const cloud = await openStore({ databaseUrl: pg.databaseUrl, projectPk });
		expect((await cloud.tasks.listByGroup("LOAD")).length).toBe(500);
		expect(await cloud.tasks.getById("LOAD-1")).not.toBeNull();
		expect(await cloud.tasks.getById("LOAD-500")).not.toBeNull();
		expect(await cloud.comments.getById("LOAD-1#1")).not.toBeNull();
		await cloud.close();
		await server.stop();
		await pg.stop();
	});
});
