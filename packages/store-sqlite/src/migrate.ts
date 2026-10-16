import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import initSql from "../../../migrations/sqlite/0001_init.sql" with { type: "text" };
import projectsSql from "../../../migrations/sqlite/0002_projects.sql" with { type: "text" };
import type { SqliteDatabase } from "./db-types.js";

const MIGRATIONS_TABLE = "_migrations";

/** SQL shipped inside the compiled binary. A compiled module cannot see `migrations/sqlite` on disk. */
export const bundledSqliteMigrations: ReadonlyArray<{ id: string; sql: string }> = [
	{ id: "0001_init.sql", sql: initSql },
	{ id: "0002_projects.sql", sql: projectsSql },
];

export function defaultMigrationsDir(): string {
	return join(fileURLToPath(new URL(".", import.meta.url)), "../../../migrations/sqlite");
}

async function ensureMigrationsTable(db: Kysely<SqliteDatabase>): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS ${sql.table(MIGRATIONS_TABLE)} (
			id TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL
		)
	`.execute(db);
}

function readMigrationFiles(dir: string): Array<{ id: string; sql: string }> {
	return readdirSync(dir)
		.filter((f) => f.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b))
		.map((id) => ({ id, sql: readFileSync(join(dir, id), "utf8") }));
}

export async function migrate(
	db: Kysely<SqliteDatabase>,
	sqliteExec: (statement: string) => void,
	migrationsDir?: string,
): Promise<string[]> {
	const files = migrationsDir ? readMigrationFiles(migrationsDir) : bundledSqliteMigrations;
	return applyMigrations(db, sqliteExec, files);
}

async function applyMigrations(
	db: Kysely<SqliteDatabase>,
	sqliteExec: (statement: string) => void,
	files: ReadonlyArray<{ id: string; sql: string }>,
): Promise<string[]> {
	await ensureMigrationsTable(db);
	const applied: string[] = [];

	for (const file of files) {
		const existing = await db
			.selectFrom(MIGRATIONS_TABLE)
			.select("id")
			.where("id", "=", file.id)
			.executeTakeFirst();
		if (existing) continue;

		sqliteExec(file.sql);
		const at = new Date().toISOString();
		await db.insertInto(MIGRATIONS_TABLE).values({ id: file.id, applied_at: at }).execute();
		applied.push(file.id);
	}

	return applied;
}
