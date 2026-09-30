import type { Pool } from "pg";
import { ulid } from "ulid";
import { generateApiToken, insertApiToken } from "./auth/apiTokens.js";

export type ProjectRef = {
	orgSlug: string;
	projectSlug: string;
};

export function parseProjectRef(ref: string): ProjectRef | null {
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash >= ref.length - 1) return null;
	return { orgSlug: ref.slice(0, slash), projectSlug: ref.slice(slash + 1) };
}

export async function resolveProjectPk(pool: Pool, ref: ProjectRef): Promise<string | null> {
	const result = await pool.query<{ pk: string }>(
		`SELECT p.pk FROM projects p
     INNER JOIN orgs o ON o.pk = p.org_pk
     WHERE o.slug = $1 AND p.slug = $2`,
		[ref.orgSlug, ref.projectSlug],
	);
	return result.rows[0]?.pk ?? null;
}

export async function ensureProject(
	pool: Pool,
	ref: ProjectRef,
	name: string,
): Promise<{ projectPk: string; orgPk: string; created: boolean }> {
	const existing = await resolveProjectPk(pool, ref);
	if (existing) {
		const org = await pool.query<{ pk: string }>(
			`SELECT org_pk as pk FROM projects WHERE pk = $1`,
			[existing],
		);
		return { projectPk: existing, orgPk: org.rows[0]?.pk ?? "", created: false };
	}
	const orgPk = ulid();
	const projectPk = ulid();
	const now = new Date().toISOString();
	await pool.query(`INSERT INTO orgs (pk, slug, name, created_at) VALUES ($1, $2, $3, $4)`, [
		orgPk,
		ref.orgSlug,
		ref.orgSlug,
		now,
	]);
	await pool.query(
		`INSERT INTO projects (pk, org_pk, slug, name, rev, settings, created_at) VALUES ($1, $2, $3, $4, 0, '{}', $5)`,
		[projectPk, orgPk, ref.projectSlug, name, now],
	);
	return { projectPk, orgPk, created: true };
}

export async function createProjectApiToken(
	pool: Pool,
	projectPk: string,
	name: string,
	toolsetCeiling: "core" | "plan" | "admin" = "plan",
	groups?: string[],
): Promise<{ token: string; tokenPk: string }> {
	const { token, hash, pk } = generateApiToken();
	await insertApiToken(pool, {
		pk,
		projectPk,
		name,
		hash,
		toolsetCeiling,
		groups,
	});
	return { token, tokenPk: pk };
}
