#!/usr/bin/env bun
/**
 * agent-todo CLI.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openStore } from "@agent-todo/store-sqlite";
import { runDaemon } from "./commands/daemon.js";
import { runDoctor } from "./commands/doctor.js";
import { parseExportArgs, runExport } from "./commands/export.js";
import { parseImportArgs, runImport } from "./commands/import.js";
import { runInit } from "./commands/init.js";
import { runInstall } from "./commands/install.js";
import { runServeMcp } from "./commands/serve.js";
import { runUninit } from "./commands/uninit.js";
import { runUninstall } from "./commands/uninstall.js";
import { runUpgrade } from "./commands/upgrade.js";

const VERSION = "0.0.0-dev";

function printUsage(): void {
	console.log(`agent-todo ${VERSION}

Usage:
  agent-todo <command> [options]

Commands:
  install         Wire agent-todo into detected agents (user-level MCP)
  uninstall       Remove agent-todo MCP entries and restore configs
  init            Initialize .agent-todo in the current project
  uninit          Remove project wiring (keeps data by default)
  doctor          Check binary, agents, project config, and database
  upgrade         Print upgrade instructions (full wiring in phase 9)
  daemon          Run the local shared daemon (mode = daemon)
  serve [--mcp]   Start the MCP server (stdio; proxies in daemon mode)
  migrate         Run database migrations
  import          Import markdown into group context
  export          Export group context markdown
  help            Show this help

Options:
  -h, --help      Show help
  -V, --version   Print version
  --yes           Non-interactive (init)
  --remote <url>  Cloud init (not available until phase 7)
  --wipe-data     Remove .agent-todo data on uninit
  --db <path>     SQLite database path (migrate; default: .agent-todo/todo.db)

Environment:
  AGENT_TODO_PROJECT    Override project discovery (.agent-todo path or repo root)
  AGENT_TODO_DB         Override SQLite path (tests / CI)
  AGENT_TODO_AGENT      Default actor name for MCP tools
  AGENT_TODO_TOOLSETS   Comma-separated toolsets (default: core)
  AGENT_TODO_TOKENS     Optional local HTTP bearer tokens (name:token,…)
  AGENT_TODO_DAEMON_IDLE_MS  Daemon idle shutdown (default 30 min)

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

function wantsMcp(args: string[]): boolean {
	return args.includes("--mcp");
}

function parseInitArgs(args: string[]): {
	yes: boolean;
	remote?: string;
} {
	let yes = false;
	let remote: string | undefined;
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--yes" || arg === "-y") yes = true;
		else if (arg === "--remote") {
			remote = args[i + 1];
			i += 1;
		}
	}
	return { yes, remote };
}

function parseDaemonArgs(args: string[]): { projectDir?: string } {
	let projectDir: string | undefined;
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--project") {
			projectDir = args[i + 1];
			i += 1;
		}
	}
	return { projectDir };
}

function parseUninitArgs(args: string[]): { yes: boolean; wipeData: boolean } {
	let yes = false;
	let wipeData = false;
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--yes" || arg === "-y") yes = true;
		if (arg === "--wipe-data") wipeData = true;
	}
	return { yes, wipeData };
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

	if (first === "install") return runInstall();

	if (first === "uninstall") return runUninstall();

	if (first === "init") {
		const opts = parseInitArgs(args);
		return runInit(opts);
	}

	if (first === "uninit") {
		const opts = parseUninitArgs(args);
		return runUninit(opts);
	}

	if (first === "doctor") return runDoctor();

	if (first === "upgrade") return runUpgrade();

	if (first === "daemon") {
		return runDaemon(parseDaemonArgs(args));
	}

	if (first === "serve") {
		if (!wantsMcp(args)) {
			console.error("serve requires --mcp (stdio MCP server)");
			return 1;
		}
		return runServeMcp();
	}

	if (first === "migrate") {
		return runMigrate(args);
	}

	if (first === "import") {
		const parsed = parseImportArgs(args);
		if (!parsed) {
			console.error("usage: agent-todo import <file.md> --group <KEY> [--mode merge|replace]");
			return 1;
		}
		return runImport(parsed);
	}

	if (first === "export") {
		const parsed = parseExportArgs(args);
		if (!parsed) {
			console.error(
				"usage: agent-todo export <GROUP> [--flavor agents_md|claude_md|plain|stub] [-o file]",
			);
			return 1;
		}
		return runExport(parsed);
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
