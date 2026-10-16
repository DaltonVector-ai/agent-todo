import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundledSqliteMigrations } from "../../packages/store-sqlite/src/migrate.ts";
import { openStore } from "../../packages/store-sqlite/src/SqliteStore.ts";

describe("bundled sqlite migrations", () => {
	test("compiled module layout has no migrations directory, and the bundle still creates projects", async () => {
		const compiledModule = "file:///packages/store-sqlite/src/migrate.ts";
		const walked = join(fileURLToPath(new URL(".", compiledModule)), "../../../migrations/sqlite");
		expect(existsSync(walked)).toBe(false);
		expect(bundledSqliteMigrations.map((m) => m.id)).toEqual([
			"0001_init.sql",
			"0002_projects.sql",
		]);
		expect(bundledSqliteMigrations[1]?.sql).toContain("CREATE TABLE projects");

		const dir = mkdtempSync(join(tmpdir(), "agent-todo-bundled-mig-"));
		const dbPath = join(dir, "todo.db");
		const store = await openStore({ path: dbPath });
		await store.close();
		const db = new Database(dbPath, { readonly: true });
		const names = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
			name: string;
		}>;
		db.close();
		expect(names.map((row) => row.name)).toContain("projects");
	});
});
