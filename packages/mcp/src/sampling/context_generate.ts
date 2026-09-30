// @ts-nocheck
import { ContextService, type ContextOp } from "@agent-todo/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { actor, toolError, type McpContext } from "../toolsets/shared.js";

export function registerContextGenerateTool(
	server: McpServer,
	ctx: McpContext,
	opts: { samplingAvailable?: boolean },
): void {
	if (!opts.samplingAvailable) return;

	server.registerTool(
		"context_generate",
		{
			description: "Draft context via client sampling.",
			inputSchema: {
				agent: z.string().optional().describe("Actor"),
				group: z.string().describe("Group"),
				section: z.string().describe("Slug"),
				instructions: z.string().optional().describe("Extra"),
			},
		},
		async (args, extra) => {
			const a = args as {
				group: string;
				section: string;
				instructions?: string;
				agent?: string;
			};
			try {
				const createMessage = extra?.createMessage;
				if (typeof createMessage !== "function") {
					return {
						isError: true,
						content: [
							{
								type: "text",
								text: "VALIDATION: MCP sampling not available on this connection · hint: use write_group_context prompt and context_update",
							},
						],
					};
				}
				const prompt = a.instructions
					? a.instructions
					: `Draft markdown body for context section "${a.section}" in group ${a.group}.`;
				const sampled = await createMessage({
					messages: [{ role: "user", content: { type: "text", text: prompt } }],
					maxTokens: 1200,
				});
				const body =
					sampled.content?.type === "text"
						? sampled.content.text
						: JSON.stringify(sampled.content);
				const contextSvc = new ContextService(ctx.store);
				const ops: ContextOp[] = [
					{
						op: "upsert",
						slug: a.section,
						title: a.section,
						body,
					},
				];
				await contextSvc.applyOps(a.group, ops, { actor: actor(ctx, a.agent) });
				return {
					content: [{ type: "text", text: `${a.group}/${a.section} updated` }],
				};
			} catch (e) {
				return toolError(e);
			}
		},
	);
}
