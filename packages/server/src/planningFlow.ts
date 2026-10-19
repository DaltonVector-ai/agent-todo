import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const FLOW_MAX_BYTES = 8 * 1024;

export const BUILTIN_PLANNING_FLOW = `When the user is shaping new work and has not chosen a skill for that step, follow this sequence. A skill they attach or name covers the step it describes.

1. Grill. Settle the decisions that would change the spec, one at a time, and recommend an answer. If the repo already answers it, read the repo.
2. Spec. Write it as that feature group's \`spec\` context section.
3. Tickets. Create tasks in that group, blockers first, with \`depends_on\`.
4. Implement. Claim work with \`task_next\` and follow the task.

When they are already working a task, do that task. This is guidance, not a gate.`;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function machineFlowsDirectory(): string {
	const override = process.env.AGENT_TODO_FLOWS_DIR?.trim();
	if (override) return override;
	return join(homedir(), ".agent-todo", "flows");
}

export function isFlowSlug(value: string): boolean {
	return SLUG_RE.test(value);
}

export function readFlowFileBody(
	slug: string,
	flowsDir = machineFlowsDirectory(),
): string | undefined {
	if (!isFlowSlug(slug)) return undefined;
	const path = join(flowsDir, `${slug}.md`);
	if (!existsSync(path)) return undefined;
	const size = statSync(path).size;
	if (size === 0 || size > FLOW_MAX_BYTES) return undefined;
	const body = readFileSync(path, "utf8");
	if (!body.trim()) return undefined;
	return body;
}

/**
 * Resolve MCP initialize instructions for one HTTP connection.
 * @param queryFlow Raw `flow` query value, or undefined when absent.
 * @param daemonFlow `flow` from daemon.toml, or undefined when the key is missing (means built-in).
 */
export function resolvePlanningFlowInstructions(
	queryFlow: string | undefined,
	daemonFlow: string | undefined,
	flowsDir = machineFlowsDirectory(),
): string | undefined {
	if (queryFlow !== undefined) {
		return resolveFlowSelector(queryFlow, flowsDir);
	}
	const setting = daemonFlow ?? "default";
	return resolveFlowSelector(setting, flowsDir);
}

function resolveFlowSelector(selector: string, flowsDir: string): string | undefined {
	const value = selector.trim();
	if (value === "off") return undefined;
	if (value === "default") return BUILTIN_PLANNING_FLOW;
	if (!isFlowSlug(value)) return undefined;
	return readFlowFileBody(value, flowsDir);
}
