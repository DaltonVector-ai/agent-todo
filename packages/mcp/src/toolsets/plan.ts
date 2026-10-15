// @ts-nocheck
import {
	CommentService,
	ContextService,
	GroupService,
	renderContextToc,
	renderGroupLine,
	shapeContextTocEntries,
	TaskService,
	validation,
	WorkService,
} from "@agent-todo/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { emptyProjectContextHint } from "../projectContext.js";
import { PLAN_TOOL_NAMES, planToolInputSchemas } from "../schemas-plan-admin.js";
import { parseContextOps } from "./contextOps.js";
import { actor, type McpContext, makeShaper, requireMachineId, toolError } from "./shared.js";

const PLAN_DESCRIPTIONS: Record<(typeof PLAN_TOOL_NAMES)[number], string> = {
	group_create: "Create a task group.",
	group_update: "Update group metadata.",
	group_list: "List groups.",
	group_get: "Get group summary and context TOC.",
	context_update: "Patch context sections.",
	context_import: "Import markdown sections.",
	context_export: "Export context markdown.",
	comment_compact: "Compact task comments.",
	task_claim: "Claim a task.",
	task_release: "Release a task claim.",
	task_move: "Move task to another group.",
};

const MACHINE_OWNED_PLAN_TOOLS = new Set<string>([
	"group_create",
	"group_list",
	"context_update",
	"task_release",
]);

function planInputSchema(name: (typeof PLAN_TOOL_NAMES)[number], ctx: McpContext) {
	const schema = planToolInputSchemas[name];
	if (!ctx.machineScope) return schema;
	switch (name) {
		case "group_update":
		case "group_get":
			return { ...schema, key: z.string().min(1).describe("Group id") };
		case "context_import":
		case "context_export":
			return { ...schema, group: z.string().min(1).describe("Group id") };
		case "comment_compact":
			return { ...schema, task: z.string().min(1).describe("Task id") };
		case "task_claim":
		case "task_release":
			return { ...schema, id: z.string().min(1).describe("Task id") };
		case "task_move":
			return {
				...schema,
				id: z.string().min(1).describe("Task id"),
				group: z.string().min(1).describe("Group id"),
			};
		default:
			return schema;
	}
}

function planDescription(name: (typeof PLAN_TOOL_NAMES)[number], ctx: McpContext): string {
	if (!ctx.machineScope) return PLAN_DESCRIPTIONS[name];
	switch (name) {
		case "group_update":
			return "Update group metadata. Requires the group id.";
		case "group_get":
			return "Get group summary and context TOC. Requires the group id.";
		case "context_import":
			return "Import markdown sections. Requires the group id.";
		case "context_export":
			return "Export context markdown. Requires the group id.";
		case "comment_compact":
			return "Compact task comments. Requires the task id.";
		case "task_claim":
			return "Claim a task. Requires the task id.";
		case "task_move":
			return "Move a task to another group. Requires the task id and the group id.";
		default:
			return PLAN_DESCRIPTIONS[name];
	}
}

export function registerPlanTools(server: McpServer, ctx: McpContext): void {
	const groups = new GroupService(ctx.store);
	const tasks = new TaskService(ctx.store);
	const comments = new CommentService(ctx.store);
	const contextSvc = new ContextService(ctx.store);
	const work = new WorkService(ctx.store);

	for (const name of PLAN_TOOL_NAMES) {
		if (ctx.machineScope && MACHINE_OWNED_PLAN_TOOLS.has(name)) continue;
		server.registerTool(
			name,
			{
				description: planDescription(name, ctx),
				inputSchema: planInputSchema(name, ctx),
			},
			async (args) => {
				const shaped = makeShaper(ctx);
				const read = args as { format?: "text" | "json"; max_tokens?: number };
				try {
					switch (name) {
						case "group_create": {
							const a = args as typeof planToolInputSchemas.group_create;
							const row = await groups.create({
								key: a.key,
								name: a.name,
								summary: a.summary,
								defaultModel: a.defaults?.default_model,
								defaultSkills: a.defaults?.default_skills,
								defaultMcps: a.defaults?.default_mcps,
								actor: actor(ctx, a.agent),
							});
							if (a.context_markdown) {
								await contextSvc.importMarkdown(row.key, a.context_markdown, actor(ctx, a.agent));
							}
							return shaped.toMcpContent(shaped.renderWriteAck({ id: row.key }));
						}
						case "group_update": {
							const a = args as typeof planToolInputSchemas.group_update;
							requireMachineId(ctx, a.key, "group id");
							const updated = await groups.update(a.key, {
								v: a.v,
								name: a.set?.name,
								summary: a.set?.summary,
								defaultModel: a.set?.defaults?.default_model,
								defaultSkills: a.set?.defaults?.default_skills,
								defaultMcps: a.set?.defaults?.default_mcps,
								actor: actor(ctx, a.agent),
							});
							return shaped.toMcpContent(
								shaped.renderWriteAck({ id: updated.key, v: updated.version }),
							);
						}
						case "group_list": {
							const a = args as typeof planToolInputSchemas.group_list;
							if (ctx.machineScope) throw validation("project code is required");
							const rows = await groups.list({ includeArchived: a.archived });
							const lines: string[] = [];
							for (const g of rows) {
								const summary = await groups.get(g.key);
								lines.push(
									renderGroupLine(g, {
										open: summary.openTasks,
										total: summary.totalTasks,
									}),
								);
							}
							return shaped.toMcpContent(
								shaped.renderRead(lines.join("\n") || "none", {
									format: read.format,
									maxTokens: read.max_tokens,
								}),
							);
						}
						case "group_get": {
							const a = args as typeof planToolInputSchemas.group_get;
							requireMachineId(ctx, a.key, "group id");
							const summary = await groups.get(a.key);
							const listed = await ctx.store.sections.listByGroup(a.key);
							const hint = emptyProjectContextHint(summary, listed);
							const toc = await contextSvc.toc(a.key);
							if (read.format === "json") {
								return shaped.toMcpContent(
									shaped.renderRead(
										hint
											? { toc: shapeContextTocEntries(toc), hint }
											: { toc: shapeContextTocEntries(toc) },
										{ format: "json", maxTokens: read.max_tokens },
									),
								);
							}
							const lines = [
								renderGroupLine(summary, {
									open: summary.openTasks,
									total: summary.totalTasks,
								}),
								renderContextToc(a.key, toc),
							];
							if (hint) lines.push(`hint: ${hint}`);
							return shaped.toMcpContent(
								shaped.renderRead(lines.join("\n"), {
									format: read.format,
									maxTokens: read.max_tokens,
								}),
							);
						}
						case "context_update": {
							const a = args as typeof planToolInputSchemas.context_update;
							const ops = parseContextOps(a.ops as Array<Record<string, unknown>>);
							const updated = await contextSvc.applyOps(a.group, ops, {
								v: a.v,
								actor: actor(ctx, a.agent),
							});
							const sections = updated.map((s) => ({
								slug: s.slug,
								v: s.version,
								tokens: s.tokens,
							}));
							return shaped.toMcpContent(
								shaped.renderRead({ sections }, { format: read.format ?? "json" }),
							);
						}
						case "context_import": {
							const a = args as typeof planToolInputSchemas.context_import;
							requireMachineId(ctx, a.group, "group id");
							const result = await contextSvc.importMarkdown(
								a.group,
								a.markdown,
								actor(ctx, a.agent),
								{ mode: a.mode },
							);
							const slugs = result.sections.map((s) => s.slug);
							const warnings = result.largeSections.length
								? [`large sections: ${result.largeSections.join(",")}`]
								: [];
							return shaped.toMcpContent(
								shaped.renderWriteAck(
									{ id: a.group, warnings: warnings.length ? warnings : undefined },
									{ slugs },
									{ format: read.format },
								),
							);
						}
						case "context_export": {
							const a = args as typeof planToolInputSchemas.context_export;
							requireMachineId(ctx, a.group, "group id");
							const md = await contextSvc.exportMarkdown(a.group, a.flavor, a.sections);
							return {
								content: [{ type: "text", text: md }],
							};
						}
						case "comment_compact": {
							const a = args as typeof planToolInputSchemas.comment_compact;
							requireMachineId(ctx, a.task, "task id");
							const result = await comments.compact({
								taskId: a.task,
								summaryBody: a.summary_body,
								keepPinned: a.keep_pinned,
								supersedes: a.supersedes,
								actor: actor(ctx, a.agent),
							});
							return shaped.toMcpContent(
								shaped.renderRead(
									{ id: result.comment.id, hidden: result.hidden },
									{ format: read.format ?? "json" },
								),
							);
						}
						case "task_claim": {
							const a = args as typeof planToolInputSchemas.task_claim;
							requireMachineId(ctx, a.id, "task id");
							const updated = await work.claim(
								a.id,
								actor(ctx, a.agent),
								a.ttl_min,
								actor(ctx, a.agent),
							);
							return shaped.toMcpContent(
								shaped.renderRead(
									{ id: updated.id, claim_expires: updated.claimExpires },
									{ format: read.format ?? "json" },
								),
							);
						}
						case "task_release": {
							const a = args as typeof planToolInputSchemas.task_release;
							requireMachineId(ctx, a.id, "task id");
							const updated = await work.release(a.id, actor(ctx, a.agent), {
								toStatus: a.to_status,
								actor: actor(ctx, a.agent),
							});
							return shaped.toMcpContent(
								shaped.renderRead(
									{ id: updated.id, status: updated.status },
									{ format: read.format ?? "json" },
								),
							);
						}
						case "task_move": {
							const a = args as typeof planToolInputSchemas.task_move;
							requireMachineId(ctx, a.id, "task id");
							requireMachineId(ctx, a.group, "group id");
							const updated = await tasks.move(a.id, a.group, actor(ctx, a.agent));
							return shaped.toMcpContent(
								shaped.renderRead(
									{ id: updated.id, group: updated.groupKey },
									{ format: read.format ?? "json" },
								),
							);
						}
						default:
							throw new Error(`unknown tool ${name}`);
					}
				} catch (e) {
					const taskId =
						typeof (args as { task?: string }).task === "string"
							? (args as { task: string }).task
							: typeof (args as { id?: string }).id === "string"
								? (args as { id: string }).id
								: undefined;
					return toolError(e, taskId);
				}
			},
		);
	}
}
