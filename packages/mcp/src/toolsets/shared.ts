import { Shaper, type Store } from "@agent-todo/core";
import { formatServiceError, isServiceError } from "../errors.js";

export type McpContext = {
	store: Store;
	defaultAgent: string;
	defaultMaxTokens: number;
};

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
