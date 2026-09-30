import { describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { SWEEP_CLAIMS_JOB_ID } from "../../packages/server/src/jobs/sweepClaims.ts";
import { hasDocker, startPostgres } from "../postgres/helpers.ts";

const docker = await hasDocker();

describe.skipIf(!docker)("advisory job locks", () => {
	test("only one worker holds sweeper lock at a time", async () => {
		const pg = await startPostgres();
		const pool = new Pool({ connectionString: pg.databaseUrl, max: 4 });
		const tryLock = async () => {
			const r = await pool.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS ok", [
				SWEEP_CLAIMS_JOB_ID,
			]);
			return r.rows[0]?.ok === true;
		};
		const first = await tryLock();
		const second = await tryLock();
		expect(first).toBe(true);
		expect(second).toBe(false);
		await pool.query("SELECT pg_advisory_unlock($1::bigint)", [SWEEP_CLAIMS_JOB_ID]);
		const third = await tryLock();
		expect(third).toBe(true);
		await pool.end();
		await pg.stop();
	});
});
