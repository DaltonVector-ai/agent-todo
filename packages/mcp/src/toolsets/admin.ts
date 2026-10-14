// @ts-nocheck
import { GroupService, TaskService } from "@agent-todo/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { ADMIN_TOOL_NAMES, adminToolInputSchemas } from "../schemas-plan-admin.js";
import { actor, type McpContext, makeShaper, requireMachineId, toolError } from "./shared.js";

const ADMIN_DESCRIPTIONS: Record<(typeof ADMIN_TOOL_NAMES)[number], string> = {
	task_archive: "Archive a task.",
	group_archive: "Archive a group.",
	history: "List entity event history.",
};

function adminInputSchema(name: (typeof ADMIN_TOOL_NAMES)[number], ctx: McpContext) {
	const schema = adminToolInputSchemas[name];
	if (!ctx.machineScope) return schema;
	if (name === "group_archive") {
		return { ...schema, key: z.string().min(1).describe("Group id") };
	}
	return {
		...schema,
		id: z
			.string()
			.min(1)
			.describe(name === "history" ? "Task or group id" : "Task id"),
	};
}

function adminDescription(name: (typeof ADMIN_TOOL_NAMES)[number], ctx: McpContext): string {
	if (!ctx.machineScope) return ADMIN_DESCRIPTIONS[name];
	switch (name) {
		case "task_archive":
			return "Archive a task. Requires the task id.";
		case "group_archive":
			return "Archive a group. Requires the group id.";
		case "history":
			return "List entity event history. Requires the task id or the group id.";
		default:
			return ADMIN_DESCRIPTIONS[name];
	}
}

export function registerAdminTools(server: McpServer, ctx: McpContext): void {
	const groups = new GroupService(ctx.store);
	const tasks = new TaskService(ctx.store);

	for (const name of ADMIN_TOOL_NAMES) {
		server.registerTool(
			name,
			{
				description: adminDescription(name, ctx),
				inputSchema: adminInputSchema(name, ctx),
			},
			async (args) => {
				const shaped = makeShaper(ctx);
				const read = args as { format?: "text" | "json"; max_tokens?: number };
				try {
					switch (name) {
						case "task_archive": {
							const a = args as typeof adminToolInputSchemas.task_archive;
							requireMachineId(ctx, a.id, "task id");
							await tasks.archive(a.id, actor(ctx, a.agent), a.hard, a.reason);
							return shaped.toMcpContent(shaped.renderWriteAck({ id: a.id }));
						}
						case "group_archive": {
							const a = args as typeof adminToolInputSchemas.group_archive;
							requireMachineId(ctx, a.key, "group id");
							const updated = await groups.archive(a.key, actor(ctx, a.agent));
							return shaped.toMcpContent(
								shaped.renderWriteAck({ id: updated.key, v: updated.version }),
							);
						}
						case "history": {
							const a = args as typeof adminToolInputSchemas.history;
							requireMachineId(ctx, a.id, "id");
							const task = ctx.machineScope ? await ctx.store.tasks.getById(a.id) : null;
							const events = await ctx.store.events.listSinceRev(0, {
								limit: 500,
								groupKey: ctx.machineScope ? (task?.groupKey ?? a.id) : undefined,
							});
							const filtered = events.filter((e) => e.entityId === a.id);
							const rev = await ctx.store.events.latestRev();
							return shaped.toMcpContent(
								shaped.renderChanges(rev, filtered, {
									format: read.format,
									maxTokens: read.max_tokens,
								}),
							);
						}
						default:
							throw new Error(`unknown tool ${name}`);
					}
				} catch (e) {
					const id =
						typeof (args as { id?: string }).id === "string"
							? (args as { id: string }).id
							: undefined;
					return toolError(e, id);
				}
			},
		);
	}
}
