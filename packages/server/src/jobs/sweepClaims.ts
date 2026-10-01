import { WorkService } from "@agent-todo/core";
import { openStore } from "@agent-todo/store-postgres";
import type { Pool } from "pg";

export const SWEEP_CLAIMS_JOB_ID = 8_001;

export async function runClaimSweeper(pool: Pool, databaseUrl: string): Promise<void> {
	const projects = await pool.query<{ pk: string }>("SELECT pk FROM projects");
	for (const row of projects.rows) {
		const store = await openStore({ databaseUrl, projectPk: row.pk });
		try {
			const work = new WorkService(store);
			await work.sweepExpiredClaims("system");
		} finally {
			await store.close();
		}
	}
}
