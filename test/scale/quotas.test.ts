import { describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { checkWriteQuota, QuotaExceededError } from "../../packages/server/src/quotas.ts";
import { seedDefaultProject } from "../../packages/store-postgres/src/index.ts";
import { hasDocker, startPostgres } from "../postgres/helpers.ts";

const docker = await hasDocker();

describe.skipIf(!docker)("postgres quotas", () => {
	test("write quota denies after 20 writes per second", async () => {
		const pg = await startPostgres();
		await seedDefaultProject(pg.databaseUrl);
		const pool = new Pool({ connectionString: pg.databaseUrl });
		const tokenPk = "quota-test-token";
		for (let i = 0; i < 20; i++) {
			await checkWriteQuota(pool, tokenPk);
		}
		await expect(checkWriteQuota(pool, tokenPk)).rejects.toBeInstanceOf(QuotaExceededError);
		await pool.end();
		await pg.stop();
	});
});
