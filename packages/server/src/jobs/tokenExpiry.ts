import type { Pool } from "pg";

export const TOKEN_EXPIRY_JOB_ID = 8_004;

export async function runTokenExpiry(pool: Pool): Promise<void> {
	const result = await pool.query(
		`DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at < NOW()`,
	);
	if ((result.rowCount ?? 0) > 0) {
		console.info(
			JSON.stringify({
				level: "info",
				job: "token_expiry",
				deleted_tokens: result.rowCount,
			}),
		);
	}
}
