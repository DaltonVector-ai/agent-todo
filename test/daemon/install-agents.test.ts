import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseInstallArgs } from "../../packages/cli/src/commands/installArgs.ts";
import { runAgentInstall } from "../../packages/cli/src/integrations/index.ts";
import { opencodeIntegration } from "../../packages/cli/src/integrations/opencode.ts";

describe("install agent selection", () => {
	let home: string;
	let mcpPath: string;
	let prevHome: string | undefined;
	let prevMcp: string | undefined;
	let prevBackup: string | undefined;

	beforeEach(() => {
		home = join(
			tmpdir(),
			`agent-todo-opencode-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mcpPath = join(home, ".config", "opencode", "mcp.json");
		prevHome = process.env.AGENT_TODO_INTEGRATION_HOME;
		prevMcp = process.env.AGENT_TODO_OPENCODE_MCP_JSON;
		prevBackup = process.env.AGENT_TODO_INTEGRATION_BACKUP_DIR;
		process.env.AGENT_TODO_INTEGRATION_HOME = home;
		process.env.AGENT_TODO_OPENCODE_MCP_JSON = mcpPath;
		process.env.AGENT_TODO_INTEGRATION_BACKUP_DIR = join(
			home,
			".agent-todo",
			"integration-backups",
		);
	});

	afterEach(() => {
		if (prevHome === undefined) delete process.env.AGENT_TODO_INTEGRATION_HOME;
		else process.env.AGENT_TODO_INTEGRATION_HOME = prevHome;
		if (prevMcp === undefined) delete process.env.AGENT_TODO_OPENCODE_MCP_JSON;
		else process.env.AGENT_TODO_OPENCODE_MCP_JSON = prevMcp;
		if (prevBackup === undefined) delete process.env.AGENT_TODO_INTEGRATION_BACKUP_DIR;
		else process.env.AGENT_TODO_INTEGRATION_BACKUP_DIR = prevBackup;
		rmSync(home, { recursive: true, force: true });
	});

	test("parseInstallArgs accepts repeated --agent", () => {
		const parsed = parseInstallArgs(["--local", "--agent", "cursor", "--agent", "opencode"]);
		expect(parsed).toEqual({
			mode: "local",
			loopback: false,
			agentIds: ["cursor", "opencode"],
		});
	});

	test("parseInstallArgs dedupes repeated --agent values", () => {
		const parsed = parseInstallArgs(["--local", "--agent", "cursor", "--agent", "cursor"]);
		expect(parsed).toEqual({ mode: "local", loopback: false, agentIds: ["cursor"] });
	});

	test("parseInstallArgs rejects unknown --agent before install", () => {
		const parsed = parseInstallArgs(["--local", "--agent", "not-a-real-agent"]);
		expect(parsed).toEqual({ error: 'agent-todo install: unknown agent "not-a-real-agent"' });
	});

	test("runAgentInstall with --agent writes even when agent is not detected", () => {
		expect(opencodeIntegration.detect()).toBe(false);

		const { exitCode } = runAgentInstall({ agentIds: ["opencode"] });
		expect(exitCode).toBe(0);
		expect(existsSync(mcpPath)).toBe(true);
		expect(readFileSync(mcpPath, "utf8")).toContain("agent-todo");

		opencodeIntegration.uninstall();
		expect(existsSync(mcpPath)).toBe(false);
	});
});

describe("install --url --agent", () => {
	test("parseInstallArgs wires external install with agents", () => {
		const parsed = parseInstallArgs(["--url", "http://127.0.0.1:8787", "--agent", "opencode"]);
		expect(parsed).toEqual({
			mode: "external",
			url: "http://127.0.0.1:8787",
			agentIds: ["opencode"],
		});
	});
});
