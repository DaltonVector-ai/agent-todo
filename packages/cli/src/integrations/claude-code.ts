import { existsSync } from "node:fs";
import { createJsonMcpIntegration } from "./json-file-agent.js";
import { claudeConfigPath } from "./paths.js";

export const claudeCodeIntegration = createJsonMcpIntegration({
	id: "claude-code",
	label: "Claude Code",
	configPath: claudeConfigPath,
	detect() {
		if (process.env.AGENT_TODO_CLAUDE_CONFIG) return true;
		try {
			const which = Bun.which("claude");
			if (which) return true;
		} catch {
			/* ignore */
		}
		return existsSync(claudeConfigPath());
	},
});
