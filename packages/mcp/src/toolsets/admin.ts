// @ts-nocheck
import { GroupService, TaskService } from "@agent-todo/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ADMIN_TOOL_NAMES, adminToolInputSchemas } from "../schemas-plan-admin.js";
import { actor, type McpContext, makeShaper, toolError } from "./shared.js";

const ADMIN_DESCRIPTIONS: Record<(typeof ADMIN_TOOL_NAMES)[number], string> = {
	task_archive: "Archive a task.",
	group_archive: "Archive a group.",
	history: "List entity event history.",
};

export function registerAdminTools(server: McpServer, ctx: McpContext): void {
	const groups = new GroupService(ctx.store);
	const tasks = new TaskService(ctx.store);

	for (const name of ADMIN_TOOL_NAMES) {
		server.registerTool(
			name,
			{
				description: ADMIN_DESCRIPTIONS[name],
				inputSchema: adminToolInputSchemas[name],
			},
			async (args) => {
				const shaped = makeShaper(ctx);
				const read = args as { format?: "text" | "json"; max_tokens?: number };
				try {
					switch (name) {
						case "task_archive": {
							const a = args as typeof adminToolInputSchemas.task_archive;
							await tasks.archive(a.id, actor(ctx, a.agent), a.hard, a.reason);
							return shaped.toMcpContent(shaped.renderWriteAck({ id: a.id }));
						}
						case "group_archive": {
							const a = args as typeof adminToolInputSchemas.group_archive;
							const updated = await groups.archive(a.key, actor(ctx, a.agent));
							return shaped.toMcpContent(
								shaped.renderWriteAck({ id: updated.key, v: updated.version }),
							);
						}
						case "history": {
							const a = args as typeof adminToolInputSchemas.history;
							const events = await ctx.store.events.listSinceRev(0, { limit: 500 });
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
