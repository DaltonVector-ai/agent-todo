import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Kysely, SqliteDialect } from "kysely";
import type { SqliteDatabase } from "./db-types.js";

type KyselyCompatDatabase = Database & {
	prepare: Database["prepare"];
};

/** Kysely's SQLite driver uses `stmt.reader`; bun:sqlite does not set it. */
function patchBunSqliteForKysely(sqlite: Database): KyselyCompatDatabase {
	const db = sqlite as KyselyCompatDatabase;
	const prepare = db.prepare.bind(db);
	db.prepare = ((sql: string) => {
		const stmt = prepare(sql) as ReturnType<Database["prepare"]> & { reader?: boolean };
		if (stmt.reader === undefined) {
			const trimmed = sql.trim();
			const isRead =
				/^\s*(WITH|SELECT|PRAGMA|EXPLAIN)\b/i.test(trimmed) || /\bRETURNING\b/i.test(sql);
			stmt.reader = isRead;
		}
		return stmt;
	}) as Database["prepare"];
	return db;
}

export type SqliteClient = {
	db: Kysely<SqliteDatabase>;
	sqlite: Database;
	close(): void;
};

export function openSqliteClient(path: string): SqliteClient {
	if (path !== ":memory:") {
		mkdirSync(dirname(path), { recursive: true });
	}
	const sqlite = patchBunSqliteForKysely(new Database(path, { create: true }));
	sqlite.exec("PRAGMA journal_mode = WAL;");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	sqlite.exec("PRAGMA busy_timeout = 5000;");

	const db = new Kysely<SqliteDatabase>({
		dialect: new SqliteDialect({
			database: sqlite as unknown as import("kysely").SqliteDatabase,
		}),
	});

	return {
		db,
		sqlite,
		close() {
			db.destroy();
		},
	};
}
