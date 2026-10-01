import { homedir } from "node:os";
import { join } from "node:path";

/** Override home for tests (e.g. temp dir). */
export function integrationHome(): string {
	return process.env.AGENT_TODO_INTEGRATION_HOME ?? homedir();
}

export function cursorMcpPath(): string {
	return process.env.AGENT_TODO_CURSOR_MCP_JSON ?? join(integrationHome(), ".cursor", "mcp.json");
}

export function vscodeMcpPath(): string {
	return process.env.AGENT_TODO_VSCODE_MCP_JSON ?? join(integrationHome(), ".vscode", "mcp.json");
}

export function geminiMcpPath(): string {
	return (
		process.env.AGENT_TODO_GEMINI_MCP_JSON ?? join(integrationHome(), ".gemini", "settings.json")
	);
}

export function opencodeMcpPath(): string {
	return (
		process.env.AGENT_TODO_OPENCODE_MCP_JSON ??
		join(integrationHome(), ".config", "opencode", "mcp.json")
	);
}

export function codexConfigPath(): string {
	return process.env.AGENT_TODO_CODEX_CONFIG ?? join(integrationHome(), ".codex", "config.toml");
}

export function claudeConfigPath(): string {
	return process.env.AGENT_TODO_CLAUDE_CONFIG ?? join(integrationHome(), ".claude.json");
}
