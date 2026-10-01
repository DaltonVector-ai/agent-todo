import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cursorIntegration } from "../../packages/cli/src/integrations/cursor.js";

describe("install round-trip", () => {
	let home: string;
	let mcpPath: string;
	let prevHome: string | undefined;
	let prevBackup: string | undefined;

	beforeEach(() => {
		home = join(
			tmpdir(),
			`agent-todo-install-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(join(home, ".cursor"), { recursive: true });
		mcpPath = join(home, ".cursor", "mcp.json");
		const fixture = {
			mcpServers: {
				other: { command: "echo", args: ["hello"] },
			},
		};
		writeFileSync(mcpPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
		const beforeBytes = readFileSync(mcpPath);

		prevHome = process.env.AGENT_TODO_INTEGRATION_HOME;
		prevBackup = process.env.AGENT_TODO_INTEGRATION_BACKUP_DIR;
		process.env.AGENT_TODO_INTEGRATION_HOME = home;
		process.env.AGENT_TODO_CURSOR_MCP_JSON = mcpPath;
		process.env.AGENT_TODO_INTEGRATION_BACKUP_DIR = join(
			home,
			".agent-todo",
			"integration-backups",
		);

		expect(readFileSync(mcpPath).equals(beforeBytes)).toBe(true);
	});

	afterEach(() => {
		if (prevHome === undefined) delete process.env.AGENT_TODO_INTEGRATION_HOME;
		else process.env.AGENT_TODO_INTEGRATION_HOME = prevHome;
		if (prevBackup === undefined) delete process.env.AGENT_TODO_INTEGRATION_BACKUP_DIR;
		else process.env.AGENT_TODO_INTEGRATION_BACKUP_DIR = prevBackup;
		delete process.env.AGENT_TODO_CURSOR_MCP_JSON;
		rmSync(home, { recursive: true, force: true });
	});

	test("install then uninstall restores fixture byte-identical", () => {
		const before = readFileSync(mcpPath);
		cursorIntegration.install();
		expect(readFileSync(mcpPath).equals(before)).toBe(false);

		cursorIntegration.uninstall();
		const after = readFileSync(mcpPath);
		expect(after.equals(before)).toBe(true);
	});
});
