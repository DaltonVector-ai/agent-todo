// MCP SDK infers zod shape types on the handler args; runtime values are plain objects.
// @ts-nocheck
import {
	changesSince,
	CommentService,
	ContextService,
	notFound,
	Shaper,
	TaskService,
	type CommentKind,
	type Store,
	type TaskStatus,
	type TaskUpdatePatch,
	WorkService,
	commentDigest,
} from "@agent-todo/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatServiceError, isServiceError } from "../errors.js";
import { CORE_TOOL_NAMES, coreToolInputSchemas } from "../schemas.js";

export type CoreMcpContext = {
	store: Store;
	defaultAgent: string;
	defaultMaxTokens: number;
};

const TOOL_DESCRIPTIONS: Record<(typeof CORE_TOOL_NAMES)[number], string> = {
	task_next: "Claim next matching open task as a work bundle.",
	task_get: "Get one task with optional includes.",
	task_list: "List tasks with filters and pagination.",
	task_create: "Create one or more tasks in a group.",
	task_update: "Patch a task with optimistic versioning.",
	task_status: "Change task status with validation.",
	comment_add: "Add a comment on a task.",
	comment_list: "List comments on a task.",
	context_get: "Get group context TOC or sections.",
	changes_since: "List events after a revision.",
};

function actor(ctx: CoreMcpContext, agent?: string): string {
	return agent ?? ctx.defaultAgent;
}

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

export function registerCoreTools(server: McpServer, ctx: CoreMcpContext): void {
	const tasks = new TaskService(ctx.store);
	const comments = new CommentService(ctx.store);
	const contextSvc = new ContextService(ctx.store);
	const work = new WorkService(ctx.store);

	for (const name of CORE_TOOL_NAMES) {
		server.registerTool(
			name,
			{
				description: TOOL_DESCRIPTIONS[name],
				inputSchema: coreToolInputSchemas[name],
			},
			async (args) => {
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
							const bundle = await work.next({
								groupKey: a.group as string | undefined,
								tags: a.tags as string[] | undefined,
								model: a.model as string | undefined,
								skills: a.skills as string[] | undefined,
								owner: actor(ctx, a.agent as string | undefined),
								ttlMinutes: a.ttl_min as number | undefined,
								claim: a.claim as boolean | undefined,
							});
							const rev = await ctx.store.events.latestRev();
							if (!bundle) {
								return shaped.toMcpContent(
									shaped.renderNoneResult({ format: read.format }),
								);
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
								acceptance: t.acceptance as { text: string; done: boolean }[] | undefined,
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
							return shaped.toMcpContent(
								shaped.renderWriteAck({ id: result.comment.id }),
							);
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
							return shaped.toMcpContent(
								shaped.renderContext(a.group, toc, sections, {
									format: read.format,
									maxTokens: read.max_tokens,
								}),
							);
						}
						case "changes_since": {
							const a = args as typeof coreToolInputSchemas.changes_since & {
								rev: number;
							};
							const delta = await changesSince(ctx.store, a.rev, {
								groupKey: a.group,
								entities: a.entities,
							});
							return shaped.toMcpContent(
								shaped.renderChanges(delta.rev, delta.events, {
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
			},
		);
	}
}
