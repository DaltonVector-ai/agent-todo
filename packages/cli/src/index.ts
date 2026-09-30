#!/usr/bin/env bun
/**
 * agent-todo CLI skeleton (phase 0).
 *
 * Stub commands exit 0 with a "not implemented" message so help paths stay clean.
 * Unknown commands exit 1.
 */

const VERSION = "0.0.0-dev";

function printUsage(): void {
	console.log(`agent-todo ${VERSION}

Usage:
  agent-todo <command> [options]

Commands:
  serve [--mcp]   Start the MCP server (stdio) — not implemented yet (phase 3)
  migrate         Run database migrations — not implemented yet (phase 1)
  help            Show this help

Options:
  -h, --help      Show help
  -V, --version   Print version

More commands (install, init, daemon, server, …) arrive in later phases.
See project_doc.md and docs/plans/README.md.
`);
}

function printVersion(): void {
	console.log(VERSION);
}

function main(argv: string[]): number {
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
		// Accept optional --mcp; behaviour arrives in phase 3.
		console.log("serve: not implemented (phase 3)");
		return 0;
	}

	if (first === "migrate") {
		console.log("migrate: not implemented (phase 1)");
		return 0;
	}

	console.error(`unknown command: ${first}`);
	return 1;
}

if (import.meta.main) {
	process.exit(main(process.argv));
}

export { main, printUsage, VERSION };
