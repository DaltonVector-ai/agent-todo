import { claudeCodeIntegration } from "./claude-code.js";
import { codexIntegration } from "./codex.js";
import { cursorIntegration } from "./cursor.js";
import { geminiIntegration } from "./gemini.js";
import { opencodeIntegration } from "./opencode.js";
import type { AgentIntegration, DoctorCheck } from "./types.js";
import { vscodeIntegration } from "./vscode.js";

export const ALL_INTEGRATIONS: AgentIntegration[] = [
	claudeCodeIntegration,
	cursorIntegration,
	codexIntegration,
	geminiIntegration,
	vscodeIntegration,
	opencodeIntegration,
];

export function runAgentInstall(): { exitCode: number } {
	let anyChanged = false;
	for (const agent of ALL_INTEGRATIONS) {
		if (!agent.detect()) continue;
		const result = agent.install();
		console.log(`${agent.label}: ${result.detail}`);
		if (result.changed) anyChanged = true;
	}
	if (!anyChanged) {
		console.log("No agent configs changed (none detected or already wired).");
	}
	return { exitCode: 0 };
}

export function runAgentUninstall(): { exitCode: number } {
	for (const agent of ALL_INTEGRATIONS) {
		const result = agent.uninstall();
		if (result.changed) {
			console.log(`${agent.label}: ${result.detail}`);
		}
	}
	return { exitCode: 0 };
}

export function collectDoctorChecks(): DoctorCheck[] {
	const checks: DoctorCheck[] = [];
	for (const agent of ALL_INTEGRATIONS) {
		if (!agent.detect()) continue;
		checks.push(...agent.doctor());
	}
	return checks;
}

export { MCP_SERVER_ENTRY, projectMcpJson } from "./mcp-entry.js";
export type { AgentIntegration, DoctorCheck } from "./types.js";
