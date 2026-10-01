import type { Pool } from "pg";
import { quotaDenied } from "./metrics.js";

export class QuotaExceededError extends Error {
	readonly code = "BUDGET" as const;
	readonly bucket: string;

	constructor(bucket: string, message: string) {
		super(message);
		this.name = "QuotaExceededError";
		this.bucket = bucket;
	}
}

type BucketConfig = {
	windowMs: number;
	limit: number;
};

const WRITES_PER_TOKEN: BucketConfig = { windowMs: 1000, limit: 20 };
const COMMENTS_PER_PROJECT_DAY: BucketConfig = { windowMs: 24 * 60 * 60 * 1000, limit: 10_000 };

function windowStart(now: Date, windowMs: number): Date {
	const t = Math.floor(now.getTime() / windowMs) * windowMs;
	return new Date(t);
}

async function incrementBucket(
	pool: Pool,
	scope: string,
	bucket: string,
	cfg: BucketConfig,
): Promise<number> {
	const ws = windowStart(new Date(), cfg.windowMs);
	const result = await pool.query<{ count: string }>(
		`INSERT INTO rate_limit_counters (scope, bucket, window_start, count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (scope, bucket, window_start)
     DO UPDATE SET count = rate_limit_counters.count + 1
     RETURNING count`,
		[scope, bucket, ws.toISOString()],
	);
	return Number(result.rows[0]?.count ?? 0);
}

/** Enforces per-token write rate (20/s). */
export async function checkWriteQuota(pool: Pool, tokenPk: string): Promise<void> {
	const count = await incrementBucket(pool, `token:${tokenPk}`, "writes_sec", WRITES_PER_TOKEN);
	if (count > WRITES_PER_TOKEN.limit) {
		quotaDenied.labels("writes_sec").inc();
		throw new QuotaExceededError("writes_sec", "write rate limit exceeded (20/s per token)");
	}
}

/** Enforces per-project comment quota (10k/day). */
export async function checkCommentQuota(pool: Pool, projectPk: string): Promise<void> {
	const count = await incrementBucket(
		pool,
		`project:${projectPk}`,
		"comments_day",
		COMMENTS_PER_PROJECT_DAY,
	);
	if (count > COMMENTS_PER_PROJECT_DAY.limit) {
		quotaDenied.labels("comments_day").inc();
		throw new QuotaExceededError("comments_day", "comment quota exceeded for project");
	}
}
