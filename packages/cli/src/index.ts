#!/usr/bin/env bun
/**
 * agent-todo CLI.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openStore } from "@agent-todo/store-sqlite";
import { runDaemon, runMachineDaemon } from "./commands/daemon.js";
import { runDoctor } from "./commands/doctor.js";
import { parseExportArgs, runExport } from "./commands/export.js";
import { parseImportArgs, runImport } from "./commands/import.js";
import { ID_LINE, runInit } from "./commands/init.js";
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
  install         Start a local server or connect to an external one, and wire detected agents
  uninstall       Restore agent configs, stop a local daemon, and remove login autostart
  init            Register this directory and write the project code and default group id into AGENTS.md
  uninit          Remove project wiring (keeps data by default)
  doctor          Check binary, agents, server URL, and project config
  upgrade         Print this repository's release URL
  daemon          Run the machine daemon (SQLite, no idle shutdown)
  serve [--mcp]   Forward stdio to the configured server
  migrate         Run database migrations
  import          Import markdown into group context
  export          Export group markdown or --format jsonl backup
  help            Show this help

Options:
  -h, --help      Show help
  -V, --version   Print version
  --yes           Non-interactive (init)
  --wipe-data     Remove .agent-todo data on uninit
  --db <path>     SQLite database path (migrate; default: .agent-todo/todo.db)

Environment:
  AGENT_TODO_PROJECT    Override project discovery (.agent-todo path or repo root)
  AGENT_TODO_DB         Override the SQLite machine database path (tests)
  AGENT_TODO_AGENT      Actor name for claims and audit
  AGENT_TODO_TOOLSETS   Comma-separated toolsets (default: core)
  AGENT_TODO_DAEMON_URL Machine daemon base URL (default http://127.0.0.1:8787)

The machine daemon uses SQLite and stays up with no idle shutdown unless this machine is an external client only.
${ID_LINE}
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

function parseInitArgs(args: string[]): { yes: boolean; error?: boolean } {
	let yes = false;
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--yes" || arg === "-y") yes = true;
		else if (arg === "--remote") {
			console.error("agent-todo: --remote init was removed; run install --url and init instead");
			return { yes: false, error: true };
		}
	}
	return { yes };
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

	if (first === "install") return runInstall(args.slice(1));

	if (first === "uninstall") return runUninstall();

	if (first === "init") {
		const opts = parseInitArgs(args);
		if (opts.error) return 1;
		let project: string | undefined;
		for (let i = 1; i < args.length; i++) {
			if (args[i] === "--project") {
				project = args[i + 1];
				i += 1;
			}
		}
		return runInit({ ...opts, project });
	}

	if (first === "uninit") {
		const opts = parseUninitArgs(args);
		return runUninit(opts);
	}

	if (first === "doctor") return runDoctor();

	if (first === "upgrade") return runUpgrade();

	if (first === "daemon") {
		const opts = parseDaemonArgs(args);
		if (opts.projectDir) return runDaemon(opts);
		return runMachineDaemon();
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
				"usage: agent-todo export <GROUP> [--flavor …] | agent-todo export --format jsonl [-o file]",
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
