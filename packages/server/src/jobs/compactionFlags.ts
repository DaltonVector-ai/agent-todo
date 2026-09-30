import type { Pool } from "pg";

export const COMPACTION_FLAGS_JOB_ID = 8_002;

/** Marks tasks whose comment volume likely needs compaction (v1: log-only scan). */
export async function runCompactionFlags(pool: Pool): Promise<void> {
	const rows = await pool.query<{ cnt: string }>(
		`SELECT COUNT(*)::text AS cnt FROM tasks WHERE comment_count > 50 AND archived = FALSE`,
	);
	const flagged = Number(rows.rows[0]?.cnt ?? 0);
	if (flagged > 0) {
		console.info(
			JSON.stringify({
				level: "info",
				job: "compaction_flags",
				tasks_over_threshold: flagged,
			}),
		);
	}
}
