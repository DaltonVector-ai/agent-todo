import { describe, expect, test } from "bun:test";
import { hashApiToken, insertApiToken } from "../../packages/server/src/auth/apiTokens.ts";
import {
	defaultMigrationsDir,
	migrate,
	openPostgresClient,
	openStore,
	seedDefaultProject,
} from "../../packages/store-postgres/src/index.ts";
import { hasDocker, startPostgres } from "../postgres/helpers.ts";

const docker = await hasDocker();

describe.skipIf(!docker)("RLS tenant isolation", () => {
	test("scoped project context hides other projects", async () => {
		const pg = await startPostgres();
		const bootstrap = openPostgresClient(pg.databaseUrl);
		await migrate(bootstrap.db, async (stmt) => bootstrap.pool.query(stmt), defaultMigrationsDir());
		await bootstrap.close();

		const a = await seedDefaultProject(pg.databaseUrl, {
			orgSlug: "acme",
			projectSlug: "alpha",
		});
		const b = await seedDefaultProject(pg.databaseUrl, {
			orgSlug: "acme",
			projectSlug: "beta",
		});

		const storeA = await openStore({ databaseUrl: pg.databaseUrl, projectPk: a.projectPk });
		await storeA.groups.create({ key: "A", name: "Alpha" });
		await storeA.tasks.create({ groupKey: "A", title: "secret", status: "open" });
		await storeA.close();

		const storeB = await openStore({ databaseUrl: pg.databaseUrl, projectPk: b.projectPk });
		const leak = await storeB.tasks.getById("A-1");
		expect(leak).toBeNull();
		await storeB.close();

		const pool = openPostgresClient(pg.databaseUrl).pool;
		const token = `at_test_${a.projectPk.slice(0, 8)}`;
		await insertApiToken(pool, {
			pk: `tok_${a.projectPk.slice(0, 8)}`,
			projectPk: a.projectPk,
			name: "core-a-only",
			hash: hashApiToken(token),
			toolsetCeiling: "core",
			groups: ["A"],
		});
		const row = await pool.query(`SELECT hash FROM api_tokens WHERE project_pk = $1`, [
			b.projectPk,
		]);
		expect(row.rows.length).toBe(0);
		await pool.end();
		await pg.stop();
	});
});
