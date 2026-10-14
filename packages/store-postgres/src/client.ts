import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { PostgresDatabase } from "./db-types.js";

export type PostgresClient = {
	db: Kysely<PostgresDatabase>;
	pool: Pool;
	close: () => Promise<void>;
};

export function openPostgresClient(databaseUrl: string, projectPk?: string): PostgresClient {
	let connectionString = databaseUrl;
	if (projectPk) {
		const u = new URL(databaseUrl);
		const setting = `-c app.project=${projectPk}`;
		const existing = u.searchParams.get("options");
		u.searchParams.set("options", existing ? `${existing} ${setting}` : setting);
		connectionString = u.toString();
	}
	const pool = new Pool({ connectionString, max: 20 });
	pool.on("error", (err) => {
		if ("code" in err && err.code === "57P01") return;
		console.error(JSON.stringify({ level: "error", msg: "postgres pool error", err: String(err) }));
	});
	const db = new Kysely<PostgresDatabase>({
		dialect: new PostgresDialect({ pool }),
	});
	return {
		db,
		pool,
		close: async () => {
			await db.destroy();
		},
	};
}
