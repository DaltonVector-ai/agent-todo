import { ulid } from "ulid";
import { openPostgresClient } from "./client.js";
import { defaultMigrationsDir, migrate } from "./migrate.js";

export type SeedProjectResult = {
	orgPk: string;
	projectPk: string;
	orgSlug: string;
	projectSlug: string;
};

/** Creates org + project rows (no RLS on these tables). */
export async function seedDefaultProject(
	databaseUrl: string,
	opts?: { orgSlug?: string; projectSlug?: string; name?: string },
): Promise<SeedProjectResult> {
	const orgSlug = opts?.orgSlug ?? "test";
	const projectSlug = opts?.projectSlug ?? "default";
	const name = opts?.name ?? "Test project";
	const now = new Date().toISOString();

	const client = openPostgresClient(databaseUrl);
	await migrate(
		client.db,
		async (stmt) => {
			await client.pool.query(stmt);
		},
		defaultMigrationsDir(),
	);

	const orgExisting = await client.pool.query<{ pk: string }>(
		`SELECT pk FROM orgs WHERE slug = $1`,
		[orgSlug],
	);
	let orgPk = orgExisting.rows[0]?.pk;
	if (!orgPk) {
		orgPk = ulid();
		await client.pool.query(
			`INSERT INTO orgs (pk, slug, name, created_at) VALUES ($1, $2, $3, $4)`,
			[orgPk, orgSlug, orgSlug, now],
		);
	}

	const projectExisting = await client.pool.query<{ pk: string }>(
		`SELECT pk FROM projects WHERE org_pk = $1 AND slug = $2`,
		[orgPk, projectSlug],
	);
	if (projectExisting.rows[0]?.pk) {
		await client.close();
		return {
			orgPk,
			projectPk: projectExisting.rows[0].pk,
			orgSlug,
			projectSlug,
		};
	}

	const projectPk = ulid();
	await client.pool.query(
		`INSERT INTO projects (pk, org_pk, slug, name, rev, settings, created_at)
     VALUES ($1, $2, $3, $4, 0, '{}', $5)`,
		[projectPk, orgPk, projectSlug, name, now],
	);
	await client.close();

	return { orgPk, projectPk, orgSlug, projectSlug };
}

export { openPostgresClient } from "./client.js";
export { defaultMigrationsDir, migrate } from "./migrate.js";
export {
	type OpenStoreOptions,
	openStore,
	PostgresStore,
	type PushPreservePayload,
} from "./PostgresStore.js";
export { setProjectContext, withProjectContext } from "./rls.js";
