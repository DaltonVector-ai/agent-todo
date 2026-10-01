import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";

export type ApiTokenRow = {
	pk: string;
	project_pk: string;
	name: string;
	hash: string;
	toolset_ceiling: "core" | "plan" | "admin";
	groups: string[] | null;
	expires_at: Date | null;
};

export function hashApiToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateApiToken(): { token: string; hash: string; pk: string } {
	const pk = randomBytes(8).toString("hex");
	const token = `at_${randomBytes(24).toString("base64url")}`;
	return { token, hash: hashApiToken(token), pk };
}

export function tokensMatch(storedHash: string, bearer: string): boolean {
	const a = Buffer.from(storedHash, "utf8");
	const b = Buffer.from(hashApiToken(bearer), "utf8");
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export async function findApiToken(pool: Pool, bearer: string): Promise<ApiTokenRow | null> {
	const hash = hashApiToken(bearer);
	const result = await pool.query<ApiTokenRow>(
		`SELECT pk, project_pk, name, hash, toolset_ceiling, groups, expires_at
     FROM api_tokens WHERE hash = $1 LIMIT 1`,
		[hash],
	);
	const row = result.rows[0];
	if (!row) return null;
	if (row.expires_at && row.expires_at.getTime() < Date.now()) return null;
	return row;
}

export async function insertApiToken(
	pool: Pool,
	input: {
		pk: string;
		projectPk: string;
		name: string;
		hash: string;
		toolsetCeiling: "core" | "plan" | "admin";
		groups?: string[];
	},
): Promise<void> {
	await pool.query(
		`INSERT INTO api_tokens (pk, project_pk, name, hash, toolset_ceiling, groups, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
		[input.pk, input.projectPk, input.name, input.hash, input.toolsetCeiling, input.groups ?? null],
	);
}
