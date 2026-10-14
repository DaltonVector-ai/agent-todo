import { Shaper, type Store } from "@agent-todo/core";
import { formatServiceError, isServiceError } from "../errors.js";

export type McpContext = {
	store: Store;
	defaultAgent: string;
	defaultMaxTokens: number;
	onToolCall?: (toolName: string, startedAtMs: number) => void;
	resourceUpdates?: () => Array<{ projectPk: string; groupKey?: string }>;
	projectPk?: string;
	/** Machine daemon: a task call must name a group id or a task id. */
	machineScope?: boolean;
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

export function actor(ctx: McpContext, agent?: string): string {
	return agent ?? ctx.defaultAgent;
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
