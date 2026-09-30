#!/usr/bin/env bun
/**
 * agent-todo CLI skeleton (phase 0–1).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openStore } from "@agent-todo/store-sqlite";

const VERSION = "0.0.0-dev";

function printUsage(): void {
	console.log(`agent-todo ${VERSION}

Usage:
  agent-todo <command> [options]

Commands:
  serve [--mcp]   Start the MCP server (stdio) — not implemented yet (phase 3)
  migrate         Run database migrations
  help            Show this help

Options:
  -h, --help      Show help
  -V, --version   Print version
  --db <path>     SQLite database path (migrate; default: .agent-todo/todo.db)

More commands (install, init, daemon, server, …) arrive in later phases.
See project_doc.md and docs/plans/README.md.
`);
}

function printVersion(): void {
	console.log(VERSION);
}

function parseMigrateArgs(args: string[]): { dbPath: string } {
	let dbPath = join(process.cwd(), ".agent-todo", "todo.db");
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--db") {
			const next = args[i + 1];
			if (next) {
				dbPath = next;
				i += 1;
			}
		}
	}
	return { dbPath };
}

async function runMigrate(args: string[]): Promise<number> {
	const { dbPath } = parseMigrateArgs(args);
	mkdirSync(join(dbPath, ".."), { recursive: true });
	const store = await openStore({ path: dbPath });
	await store.close();
	console.log(`migrations applied: ${dbPath}`);
	return 0;
}

function main(argv: string[]): number | Promise<number> {
	const args = argv.slice(2);
	const first = args[0];

	if (args.length === 0 || first === "help" || first === "--help" || first === "-h") {
		printUsage();
		return 0;
	}

	if (first === "--version" || first === "-V") {
		printVersion();
		return 0;
	}

	if (first === "serve") {
		console.log("serve: not implemented (phase 3)");
		return 0;
	}

	if (first === "migrate") {
		return runMigrate(args);
	}

	console.error(`unknown command: ${first}`);
	return 1;
}

if (import.meta.main) {
	const code = main(process.argv);
	if (code instanceof Promise) {
		code
			.then((c) => process.exit(c))
			.catch((err) => {
				console.error(err);
				process.exit(1);
			});
	} else {
		process.exit(code);
	}
}

export { main, printUsage, VERSION };
