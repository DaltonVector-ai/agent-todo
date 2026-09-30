import type { Pool } from "pg";

export const RETENTION_JOB_ID = 8_003;

const DEFAULT_RETENTION_DAYS = Number(process.env.EVENT_RETENTION_DAYS ?? 180);

/** Rolls events older than retention window (v1: delete; history archival stub). */
export async function runRetention(pool: Pool): Promise<void> {
	const days = DEFAULT_RETENTION_DAYS;
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const result = await pool.query(`DELETE FROM events WHERE at < $1`, [cutoff.toISOString()]);
	console.info(
		JSON.stringify({
			level: "info",
			job: "retention",
			deleted_events: result.rowCount ?? 0,
			cutoff: cutoff.toISOString(),
		}),
	);
}
