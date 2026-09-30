import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { PostgresDatabase } from "./db-types.js";

const MIGRATIONS_TABLE = "_migrations";

export function defaultMigrationsDir(): string {
	return join(fileURLToPath(new URL(".", import.meta.url)), "../../../migrations/postgres");
}

async function ensureMigrationsTable(db: Kysely<PostgresDatabase>): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS ${sql.table(MIGRATIONS_TABLE)} (
			id TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL
		)
	`.execute(db);
}

function listMigrationFiles(dir: string): string[] {
	return readdirSync(dir)
		.filter((f) => f.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b));
}

export async function migrate(
	db: Kysely<PostgresDatabase>,
	poolQuery: (statement: string) => Promise<void>,
	migrationsDir: string,
): Promise<string[]> {
	await ensureMigrationsTable(db);
	const applied: string[] = [];
	const files = listMigrationFiles(migrationsDir);

	for (const file of files) {
		const id = file;
		const existing = await db
			.selectFrom(MIGRATIONS_TABLE)
			.select("id")
			.where("id", "=", id)
			.executeTakeFirst();
		if (existing) continue;

		const body = readFileSync(join(migrationsDir, file), "utf8");
		await poolQuery(body);
		const at = new Date().toISOString();
		await db.insertInto(MIGRATIONS_TABLE).values({ id, applied_at: at }).execute();
		applied.push(id);
	}

	return applied;
}
