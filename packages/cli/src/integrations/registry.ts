import { claudeCodeIntegration } from "./claude-code.js";
import { codexIntegration } from "./codex.js";
import { cursorIntegration } from "./cursor.js";
import { geminiIntegration } from "./gemini.js";
import { opencodeIntegration } from "./opencode.js";
import type { AgentIntegration } from "./types.js";
import { vscodeIntegration } from "./vscode.js";

export const ALL_INTEGRATIONS: AgentIntegration[] = [
	claudeCodeIntegration,
	cursorIntegration,
	codexIntegration,
	geminiIntegration,
	vscodeIntegration,
	opencodeIntegration,
];

const byId = new Map(ALL_INTEGRATIONS.map((agent) => [agent.id, agent]));

export function validateAgentIds(ids: string[]): string | undefined {
	for (const id of ids) {
		if (!byId.has(id)) {
			return `agent-todo install: unknown agent "${id}"`;
		}
	}
	return undefined;
}

/** Detected agents, in registry order. */
export function detectedIntegrations(): AgentIntegration[] {
	return ALL_INTEGRATIONS.filter((agent) => agent.detect());
}

/**
 * @param agentIds When set, install exactly these agents (detect not required).
 *   When omitted, install only detected agents.
 */
export function integrationsForInstall(agentIds?: string[]): AgentIntegration[] {
	if (agentIds === undefined) {
		return detectedIntegrations();
	}
	return agentIds.map((id) => {
		const agent = byId.get(id);
		if (!agent) throw new Error(`unknown agent ${id}`);
		return agent;
	});
}

export function formatAgentLabels(ids: string[]): string {
	return ids.map((id) => byId.get(id)?.label ?? id).join(", ");
}
