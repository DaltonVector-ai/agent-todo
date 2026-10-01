import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { PostgresDatabase } from "./db-types.js";

export async function setProjectContext(
	db: Kysely<PostgresDatabase>,
	projectPk: string,
): Promise<void> {
	await sql`SELECT set_config('app.project', ${projectPk}, true)`.execute(db);
}

export async function withProjectContext<T>(
	db: Kysely<PostgresDatabase>,
	projectPk: string,
	fn: () => Promise<T>,
): Promise<T> {
	await sql`BEGIN`.execute(db);
	try {
		await setProjectContext(db, projectPk);
		const result = await fn();
		await sql`COMMIT`.execute(db);
		return result;
	} catch (err) {
		await sql`ROLLBACK`.execute(db);
		throw err;
	}
}
