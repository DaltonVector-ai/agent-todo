import { WorkService } from "@agent-todo/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { actor, type McpContext, makeShaper, toolError, withToolTelemetry } from "./shared.js";

export function registerMachineTaskTools(server: McpServer, ctx: McpContext): void {
	const work = new WorkService(ctx.store);

	server.registerTool(
		"task_release",
		{
			description: "Release a task claim. Requires only the task id.",
			inputSchema: {
				agent: z.string().optional().describe("Actor"),
				id: z.string().min(1).describe("Task id"),
				to_status: z.enum(["open", "todo"]).optional().describe("Status"),
			},
		},
		async (args) =>
			withToolTelemetry(ctx, "task_release", async () => {
				const a = args as { agent?: string; id: string; to_status?: "open" | "todo" };
				const shaped = makeShaper(ctx);
				try {
					const updated = await work.release(a.id, actor(ctx, a.agent), {
						toStatus: a.to_status,
						actor: actor(ctx, a.agent),
					});
					return shaped.toMcpContent(
						shaped.renderRead({ id: updated.id, status: updated.status }, { format: "json" }),
					);
				} catch (e) {
					return toolError(e, a.id);
				}
			}),
	);
}
