import { resolveActor, Shaper, type Store, validation } from "@agent-todo/core";
import { formatServiceError, isServiceError } from "../errors.js";
import type { MachineProjectTools } from "./machineProjects.js";

export type McpContext = {
	store: Store;
	defaultAgent: string;
	defaultMaxTokens: number;
	onToolCall?: (toolName: string, startedAtMs: number) => void;
	resourceUpdates?: () => Array<{ projectPk: string; groupKey?: string }>;
	projectPk?: string;
	/** Machine daemon: a task call must name a group id or a task id. */
	machineScope?: boolean;
	machineProjects?: MachineProjectTools;
};

export async function withToolTelemetry<T>(
	ctx: McpContext,
	toolName: string,
	fn: () => Promise<T>,
): Promise<T> {
	const started = Date.now();
	try {
		return await fn();
	} finally {
		ctx.onToolCall?.(toolName, started);
	}
}

export function actor(ctx: { defaultAgent: string }, agent?: string | null): string {
	return resolveActor({ agent, tokenName: ctx.defaultAgent });
}

/** Machine daemon: refuse a call that would otherwise scan every project. */
export function requireMachineId(
	ctx: { machineScope?: boolean },
	value: unknown,
	label: string,
): void {
	if (!ctx.machineScope) return;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw validation(`${label} is required`);
	}
}

export function makeShaper(ctx: McpContext): Shaper {
	return new Shaper(ctx.defaultMaxTokens);
}

export function toolError(e: unknown, taskId?: string) {
	if (isServiceError(e)) {
		return {
			isError: true as const,
			content: [{ type: "text" as const, text: formatServiceError(e, { taskId }) }],
		};
	}
	if (e instanceof Error) {
		return {
			isError: true as const,
			content: [
				{
					type: "text" as const,
					text: `VALIDATION: ${e.message} · hint: fix inputs and retry`,
				},
			],
		};
	}
	throw e;
}
