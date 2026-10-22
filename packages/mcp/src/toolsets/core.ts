// MCP SDK infers zod shape types on the handler args; runtime values are plain objects.
// @ts-nocheck
import {
	type CommentKind,
	CommentService,
	ContextService,
	changesSince,
	commentDigest,
	contextReadPayload,
	notFound,
	Shaper,
	type Store,
	TaskService,
	type TaskStatus,
	type TaskUpdatePatch,
	WorkService,
} from "@agent-todo/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { acceptanceStringsToItems } from "../acceptance.js";
import { TASK_NEXT_DESCRIPTION } from "../agentUsageGuide.js";
import { formatServiceError, isServiceError } from "../errors.js";
import { attachEmptyProjectContextHint, emptyProjectContextHint } from "../projectContext.js";
import {
	CONTEXT_GET_DESCRIPTION,
	CORE_TOOL_NAMES,
	coreToolInputSchemas,
	TASK_CREATE_DESCRIPTION,
} from "../schemas.js";
import { actor, requireMachineId, withToolTelemetry } from "./shared.js";

export type CoreMcpContext = {
	store: Store;
	defaultAgent: string;
	defaultMaxTokens: number;
	/** Machine daemon: listing or claiming must name a group id. */
	machineScope?: boolean;
};

const GROUP_REQUIRED_ON_MACHINE = new Set(["task_create", "task_list"]);

function inputSchemaFor(name: (typeof CORE_TOOL_NAMES)[number], ctx: CoreMcpContext) {
	const schema = coreToolInputSchemas[name];
	if (!ctx.machineScope) return schema;
	if (name === "task_next") {
		return {
			...schema,
			group: z.string().min(1).optional().describe("Group id"),
			project: z.string().min(1).optional().describe("Project code"),
		};
	}
	if (!GROUP_REQUIRED_ON_MACHINE.has(name)) return schema;
	return {
		...schema,
		group: z.string().min(1).describe("Group id"),
	};
}

const TOOL_DESCRIPTIONS: Record<(typeof CORE_TOOL_NAMES)[number], string> = {
	task_next: TASK_NEXT_DESCRIPTION,
	task_get: "Get one task with optional includes.",
	task_list: "List tasks with filters and pagination.",
	task_create: TASK_CREATE_DESCRIPTION,
	task_update: "Patch a task with optimistic versioning.",
	task_status: "Change task status with validation.",
	comment_add: "Add a comment on a task.",
	comment_list: "List comments on a task.",
	context_get: CONTEXT_GET_DESCRIPTION,
	changes_since: "List events after a revision.",
};

function makeShaper(ctx: CoreMcpContext): Shaper {
	return new Shaper(ctx.defaultMaxTokens);
}

function toolError(e: unknown, taskId?: string) {
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

type ReadArgs = {
	agent?: string;
	view?: "id" | "line" | "brief" | "full";
	fields?: string[];
	max_tokens?: number;
	format?: "text" | "json";
};

async function resolveTaskNextScope(
	ctx: CoreMcpContext,
	raw: { group?: string; project?: string },
): Promise<{ groupKey?: string; projectCode?: string }> {
	const groupKey = typeof raw.group === "string" && raw.group.trim() ? raw.group.trim() : undefined;
	const projectCode =
		typeof raw.project === "string" && raw.project.trim() ? raw.project.trim() : undefined;

	if (!ctx.machineScope) {
		return { groupKey, projectCode: undefined };
	}

	if (!groupKey && !projectCode) {
		throw validation("group id or project code is required");
	}

	if (groupKey && projectCode) {
		const group = await ctx.store.groups.getByKey(groupKey);
		if (!group || group.projectCode !== projectCode) {
			throw validation("group is not in that project");
		}
		return { groupKey };
	}

	if (projectCode) {
		if (!ctx.machineProjects) {
			throw validation("project code is required");
		}
		try {
			await ctx.machineProjects.listGroups(projectCode);
		} catch (err) {
			if (err instanceof Error) throw validation(err.message);
			throw err;
		}
		return { projectCode };
	}

	return { groupKey };
}

export function registerCoreTools(server: McpServer, ctx: CoreMcpContext): void {
	const tasks = new TaskService(ctx.store);
	const comments = new CommentService(ctx.store);
	const contextSvc = new ContextService(ctx.store);
	const work = new WorkService(ctx.store);

	for (const name of CORE_TOOL_NAMES) {
		server.registerTool(
			name,
			{
				description:
					ctx.machineScope && name === "task_create"
						? "Create one or more tasks in a group, which requires the group id; tags select context sections."
						: ctx.machineScope && name === "changes_since"
							? `${TOOL_DESCRIPTIONS[name]} Requires a group id or a task id.`
							: ctx.machineScope && GROUP_REQUIRED_ON_MACHINE.has(name)
								? `${TOOL_DESCRIPTIONS[name]} Requires the group id.`
								: TOOL_DESCRIPTIONS[name],
				inputSchema: inputSchemaFor(name, ctx),
			},
			async (args) =>
				withToolTelemetry(ctx, name, async () => {
					const shaped = makeShaper(ctx);
					const read = args as ReadArgs;
					const taskId =
						typeof (args as { id?: string }).id === "string"
							? (args as { id: string }).id
							: typeof (args as { task?: string }).task === "string"
								? (args as { task: string }).task
								: undefined;
					try {
						switch (name) {
							case "task_next": {
								const a = args as typeof coreToolInputSchemas.task_next & Record<string, unknown>;
								const scope = await resolveTaskNextScope(ctx, {
									group: a.group as string | undefined,
									project: a.project as string | undefined,
								});
								const bundle = await work.next({
									groupKey: scope.groupKey,
									projectCode: scope.projectCode,
									tags: a.tags as string[] | undefined,
									model: a.model as string | undefined,
									skills: a.skills as string[] | undefined,
									owner: actor(ctx, a.agent as string | undefined),
									ttlMinutes: a.ttl_min as number | undefined,
									claim: a.claim as boolean | undefined,
								});
								const rev = await ctx.store.events.latestRev();
								if (!bundle) {
									return shaped.toMcpContent(shaped.renderNoneResult({ format: read.format }));
								}
								return shaped.toMcpContent(
									shaped.renderWorkBundle(bundle, rev, {
										format: read.format,
										maxTokens: read.max_tokens,
										fields: read.fields,
										view: read.view,
									}),
								);
							}
							case "task_get": {
								const a = args as typeof coreToolInputSchemas.task_get & { id: string };
								const task = await ctx.store.tasks.getById(a.id);
								if (!task) throw notFound("task", a.id);
								const allComments = await ctx.store.comments.listByTask(a.id);
								const digest = commentDigest(allComments);
								const needsCompaction = comments.needsCompactionFlag(allComments);
								const rev = await ctx.store.events.latestRev();
								const extras: Record<string, unknown> = { rev };
								if (needsCompaction) {
									extras.needs_compaction = true;
									extras.compaction_hint =
										"run compact prompt or comment_compact before adding more notes";
								}
								const include = a.include ?? [];
								if (include.includes("comments")) {
									const live = await comments.list(a.id);
									extras.comments = live.map((c) => ({
										id: c.id,
										kind: c.kind,
										summary: c.summary,
									}));
								}
								if (include.includes("deps")) {
									extras.depends_on = await ctx.store.tasks.listDependsOn(a.id);
								}
								if (include.includes("history")) {
									const events = await ctx.store.events.listSinceRev(0, {
										groupKey: task.groupKey,
										limit: 300,
									});
									extras.history = events.filter((e) => e.entityId === a.id).slice(-20);
								}
								if (include.includes("context")) {
									extras.context = await contextSvc.forTask(task);
								}
								return shaped.toMcpContent(
									shaped.renderTaskGet(task, {
										format: read.format,
										maxTokens: read.max_tokens,
										fields: read.fields,
										view: read.view,
										digest,
										extras,
									}),
								);
							}
							case "task_list": {
								const a = args as typeof coreToolInputSchemas.task_list & Record<string, unknown>;
								requireMachineId(ctx, a.group, "group id");
								const { tasks: rows, nextCursor } = await tasks.list({
									groupKey: a.group as string | undefined,
									status: a.status as TaskStatus[] | undefined,
									tags: a.tags as string[] | undefined,
									assignee: a.assignee as string | undefined,
									q: a.q as string | undefined,
									sort: a.sort as "priority" | "updated" | undefined,
									cursor: a.cursor as string | undefined,
									limit: a.limit as number | undefined,
								});
								const rev = await ctx.store.events.latestRev();
								const groupKey = a.group as string | undefined;
								let openCount = 0;
								let total = rows.length;
								if (groupKey) {
									const all = await ctx.store.tasks.listByGroup(groupKey);
									total = all.filter((t) => !t.archived).length;
									openCount = all.filter(
										(t) => !t.archived && (t.status === "open" || t.status === "reopen"),
									).length;
								}
								const digests = new Map<string, ReturnType<typeof commentDigest>>();
								for (const t of rows) {
									if (t.commentCount > 0) {
										const cs = await comments.list(t.id);
										digests.set(t.id, commentDigest(cs));
									}
								}
								return shaped.toMcpContent(
									shaped.renderTaskList({
										groupKey,
										rev,
										openCount,
										total,
										tasks: rows,
										digests,
										nextCursor,
										format: read.format,
										maxTokens: read.max_tokens,
										fields: read.fields,
										view: read.view,
										limit: a.limit as number | undefined,
										cursor: a.cursor as string | undefined,
									}),
								);
							}
							case "task_create": {
								const a = args as typeof coreToolInputSchemas.task_create & {
									group: string;
									echo?: boolean;
									tasks: Array<Record<string, unknown>>;
								};
								requireMachineId(ctx, a.group, "group id");
								const items = a.tasks.map((t) => ({
									title: t.title as string,
									description: t.description as string | undefined,
									priority: t.priority as number | undefined,
									preferredModel: t.preferred_model as string | null | undefined,
									skills: t.skills as string[] | undefined,
									mcps: t.mcps as string[] | undefined,
									tags: t.tags as string[] | undefined,
									dependsOn: t.depends_on as string[] | undefined,
									parent: t.parent as string | undefined,
									acceptance: acceptanceStringsToItems(t.acceptance as string[] | undefined),
								}));
								const { tasks: created, warnings } = await tasks.create(
									a.group,
									items,
									actor(ctx, a.agent),
								);
								const acks = created.map((t) => ({ id: t.id, v: t.version }));
								if (a.echo) {
									return shaped.toMcpContent(
										shaped.renderRead({ tasks: created, warnings }, { format: "json" }),
									);
								}
								const text = acks.map((x) => `${x.id} v=${x.v}`).join("\n");
								return {
									content: [
										{
											type: "text",
											text: warnings.length ? `${text}\n${warnings.join("\n")}` : text,
										},
									],
									structuredContent: { tasks: acks, warnings },
								};
							}
							case "task_update": {
								const a = args as typeof coreToolInputSchemas.task_update & {
									id: string;
									v: number;
									echo?: boolean;
								};
								const patch: TaskUpdatePatch = {
									set: a.set,
									appendDescription: a.append_description,
									add: a.add,
									remove: a.remove,
								};
								const updated = await tasks.update(a.id, a.v, patch, {
									force: a.force,
									actor: actor(ctx, a.agent),
								});
								if (a.echo) {
									return shaped.toMcpContent(
										shaped.renderRead({ task: updated }, { format: "json" }),
									);
								}
								return shaped.toMcpContent(
									shaped.renderWriteAck({ id: updated.id, v: updated.version }),
								);
							}
							case "task_status": {
								const a = args as typeof coreToolInputSchemas.task_status & {
									id: string;
									v: number;
									to: TaskStatus;
									echo?: boolean;
								};
								const updated = await tasks.status(a.id, a.v, {
									to: a.to,
									comment: a.comment
										? { body: a.comment.body, kind: a.comment.kind as CommentKind | undefined }
										: undefined,
									force: a.force,
									reason: a.reason,
									actor: actor(ctx, a.agent),
								});
								if (a.echo) {
									return shaped.toMcpContent(
										shaped.renderRead({ task: updated }, { format: "json" }),
									);
								}
								return shaped.toMcpContent(
									shaped.renderWriteAck({
										id: updated.id,
										v: updated.version,
										status: updated.status,
									}),
								);
							}
							case "comment_add": {
								const a = args as typeof coreToolInputSchemas.comment_add & {
									task: string;
									body: string;
								};
								const result = await comments.add({
									taskId: a.task,
									author: actor(ctx, a.agent),
									kind: (a.kind as CommentKind | undefined) ?? "note",
									body: a.body,
									summary: a.summary,
									pinned: a.pinned,
									replyTo: a.reply_to,
									actor: actor(ctx, a.agent),
								});
								return shaped.toMcpContent(shaped.renderWriteAck({ id: result.comment.id }));
							}
							case "comment_list": {
								const a = args as typeof coreToolInputSchemas.comment_list & { task: string };
								const rows = await comments.list(a.task, {
									sinceId: a.since,
									kinds: a.kinds as CommentKind[] | undefined,
									ids: a.ids,
									includeCompacted: a.include_compacted,
								});
								return shaped.toMcpContent(
									shaped.renderComments(rows, {
										format: read.format,
										maxTokens: read.max_tokens,
										view: a.view,
									}),
								);
							}
							case "context_get": {
								const a = args as typeof coreToolInputSchemas.context_get & {
									group: string;
									for_task?: string;
									sections?: string[];
								};
								const group = await ctx.store.groups.getByKey(a.group);
								const listed = await ctx.store.sections.listByGroup(a.group);
								const hint = emptyProjectContextHint(group, listed);
								const toc = await contextSvc.toc(a.group);
								let sections: Awaited<ReturnType<ContextService["getSections"]>> = [];
								if (a.for_task) {
									const task = await ctx.store.tasks.getById(a.for_task);
									if (!task) throw notFound("task", a.for_task);
									const ft = await contextSvc.forTask(task);
									sections = ft.sections;
								} else if (a.sections?.length) {
									sections = await contextSvc.getSections(a.group, a.sections);
								}
								const payload = contextReadPayload(a.group, toc, sections);
								const attached = attachEmptyProjectContextHint(payload.text, payload.json, hint);
								return shaped.toMcpContent(
									shaped.renderRead(read.format === "json" ? attached.json : attached.text, {
										format: read.format,
										maxTokens: read.max_tokens,
									}),
								);
							}
							case "changes_since": {
								const a = args as typeof coreToolInputSchemas.changes_since & {
									rev: number;
									task?: string;
								};
								const group = typeof a.group === "string" ? a.group.trim() : "";
								const task = typeof a.task === "string" ? a.task.trim() : "";
								if (ctx.machineScope && !group && !task) {
									requireMachineId(ctx, undefined, "group id or task id");
								}
								let groupKey = group || undefined;
								if (task && !groupKey) {
									const row = await ctx.store.tasks.getById(task);
									if (!row) {
										const rev = await ctx.store.events.latestRev();
										return shaped.toMcpContent(
											shaped.renderChanges(rev, [], {
												format: read.format,
												maxTokens: read.max_tokens,
											}),
										);
									}
									groupKey = row.groupKey;
								}
								const delta = await changesSince(ctx.store, a.rev, {
									groupKey,
									entities: a.entities,
								});
								const events = task
									? delta.events.filter(
											(event) => event.entityId === task || event.entityId.startsWith(`${task}#`),
										)
									: delta.events;
								return shaped.toMcpContent(
									shaped.renderChanges(delta.rev, events, {
										format: read.format,
										maxTokens: read.max_tokens,
									}),
								);
							}
							default:
								throw new Error(`unknown tool ${name}`);
						}
					} catch (e) {
						return toolError(e, taskId);
					}
				}),
		);
	}
}
