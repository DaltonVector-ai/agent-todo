import type { Pool } from "pg";

export type BackgroundJob = {
	id: number;
	name: string;
	run: (pool: Pool) => Promise<void>;
};

export type JobRunnerOptions = {
	pool: Pool;
	jobs: BackgroundJob[];
	intervalMs?: number;
	enabled?: boolean;
};

/** Competes for pg_try_advisory_lock(job id) across server nodes. */
export function startJobRunner(opts: JobRunnerOptions): () => void {
	if (opts.enabled === false) return () => {};
	const intervalMs = opts.intervalMs ?? 60_000;
	let stopped = false;

	const tick = async () => {
		if (stopped) return;
		for (const job of opts.jobs) {
			const lock = await opts.pool.query<{ ok: boolean }>(
				"SELECT pg_try_advisory_lock($1::bigint) AS ok",
				[job.id],
			);
			if (!lock.rows[0]?.ok) continue;
			try {
				await job.run(opts.pool);
			} catch (e) {
				console.error(JSON.stringify({ level: "error", job: job.name, err: String(e) }));
			} finally {
				await opts.pool.query("SELECT pg_advisory_unlock($1::bigint)", [job.id]);
			}
		}
	};

	const timer = setInterval(() => void tick().catch(() => {}), intervalMs);
	void tick().catch(() => {});

	return () => {
		stopped = true;
		clearInterval(timer);
	};
}
