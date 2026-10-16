import { ALL_INTEGRATIONS, integrationsForInstall, validateAgentIds } from "./registry.js";
import type { DoctorCheck } from "./types.js";

export { ALL_INTEGRATIONS } from "./registry.js";

export type RunAgentInstallOptions = {
	/** Explicit agent ids from flags or the install prompt. */
	agentIds?: string[];
};

export function runAgentInstall(opts: RunAgentInstallOptions = {}): { exitCode: number } {
	if (opts.agentIds) {
		const err = validateAgentIds(opts.agentIds);
		if (err) {
			console.error(err);
			return { exitCode: 1 };
		}
	}

	let anyChanged = false;
	const targets = integrationsForInstall(opts.agentIds);
	for (const agent of targets) {
		const result = agent.install();
		console.log(`${agent.label}: ${result.detail}`);
		if (result.changed) anyChanged = true;
	}
	if (!anyChanged) {
		console.log("No agent configs changed (none selected or already wired).");
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
