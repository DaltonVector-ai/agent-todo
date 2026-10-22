import type { ReopenCommentKind, TaskStatus } from "../domain/status.js";
import { validateStatusTransition } from "../domain/status.js";
import type { Store } from "../store/Store.js";
import type { TaskRow } from "../store/types.js";
import { estimate } from "../util/tokens.js";
import type { CommentKind } from "./CommentService.js";
import { CommentService } from "./CommentService.js";
import { notFound, ServiceError, validation } from "./errors.js";
import { appendEvent, fieldDiff } from "./eventLog.js";

export type CreateTaskItem = {
	title: string;
	description?: string;
	status?: TaskStatus;
	priority?: number;
	preferredModel?: string | null;
	skills?: string[];
	mcps?: string[];
	tags?: string[];
	dependsOn?: string[];
	parent?: string;
	acceptance?: { text: string; done: boolean }[];
	assignee?: string | null;
};

export type TaskUpdatePatch = {
	set?: Partial<{
		title: string;
		description: string;
		priority: number;
		preferredModel: string | null;
		assignee: string | null;
	}>;
	appendDescription?: string;
	add?: { tags?: string[]; skills?: string[]; mcps?: string[] };
	remove?: { tags?: string[]; skills?: string[]; mcps?: string[] };
};

export type TaskListQuery = {
	groupKey?: string;
	status?: TaskStatus[];
	tags?: string[];
	assignee?: string;
	q?: string;
	sort?: "priority" | "updated";
	cursor?: string;
	limit?: number;
};

export type TaskListResult = {
	tasks: TaskRow[];
	nextCursor?: string;
};

export type StatusChangeInput = {
	to: TaskStatus;
	comment?: { body: string; kind: CommentKind };
	force?: boolean;
	reason?: string;
	actor?: string;
};

export class TaskService {
	private readonly comments: CommentService;

	constructor(private readonly store: Store) {
		this.comments = new CommentService(store);
	}

	async create(
		groupKey: string,
		items: CreateTaskItem[],
		actor = "anonymous",
	): Promise<{ tasks: TaskRow[]; warnings: string[] }> {
		if (items.length < 1 || items.length > 50) {
			throw validation("Batch size must be 1–50");
		}
		const group = await this.store.groups.getByKey(groupKey);
		if (!group) throw notFound("group", groupKey);

		const warnings: string[] = [];
		const tasks: TaskRow[] = [];

		await this.store.tx(async (s) => {
			for (const item of items) {
				if (item.title.length > 200) {
					throw validation("Title must be ≤ 200 characters", { title: item.title });
				}
				const description = item.description ?? "";
				if (estimate(description) > 4000) {
					warnings.push(`Description for "${item.title}" exceeds ~4k tokens`);
				}

				const dependsOnPks: string[] = [];
				if (item.dependsOn?.length) {
					for (const depId of item.dependsOn) {
						const dep = await s.tasks.getById(depId);
						if (!dep) throw notFound("task", depId);
						dependsOnPks.push(dep.pk);
					}
				}

				let parentPk: string | null = null;
				if (item.parent) {
					const parent = await s.tasks.getById(item.parent);
					if (!parent) throw notFound("task", item.parent);
					parentPk = parent.pk;
				}

				const task = await s.tasks.create({
					groupKey,
					title: item.title,
					description,
					status: item.status,
					priority: item.priority,
					preferredModel: item.preferredModel ?? group.defaultModel,
					skills: item.skills ?? [...group.defaultSkills],
					mcps: item.mcps ?? [...group.defaultMcps],
					tags: item.tags,
					acceptance: item.acceptance,
					assignee: item.assignee,
					parentPk,
					dependsOnPks,
				});

				await appendEvent(s, {
					entity: "task",
					entityId: task.id,
					groupKey,
					action: "create",
					actor,
					diff: { title: [null, task.title] },
				});
				tasks.push(task);
			}
		});

		return { tasks, warnings };
	}

	async update(
		id: string,
		v: number,
		patch: TaskUpdatePatch,
		opts: { force?: boolean; actor?: string; claimOwner?: string } = {},
	): Promise<TaskRow> {
		const actor = opts.actor ?? "anonymous";
		const existing = await this.store.tasks.getById(id);
		if (!existing) throw notFound("task", id);
		if (existing.version !== v) {
			throw new ServiceError("VERSION_CONFLICT", "Task version mismatch", {
				currentV: existing.version,
				changedFields: this.conflictFields(existing, patch),
			});
		}
		this.assertClaim(existing, opts.claimOwner ?? actor, opts.force);

		return await this.store.tx(async (s) => {
			const before = { ...existing };
			const title = patch.set?.title ?? existing.title;
			let description = patch.set?.description ?? existing.description;
			if (patch.appendDescription) {
				description = `${description}\n${patch.appendDescription}`.trim();
			}
			if (title.length > 200) throw validation("Title must be ≤ 200 characters");

			let tags = [...existing.tags];
			let skills = [...existing.skills];
			let mcps = [...existing.mcps];
			tags = applyListOps(tags, patch.add?.tags, patch.remove?.tags);
			skills = applyListOps(skills, patch.add?.skills, patch.remove?.skills);
			mcps = applyListOps(mcps, patch.add?.mcps, patch.remove?.mcps);

			const updated = await s.tasks.update(id, {
				title,
				description,
				priority: patch.set?.priority,
				preferredModel: patch.set?.preferredModel,
				assignee: patch.set?.assignee,
				tags,
				skills,
				mcps,
				version: v,
			});

			const diff = fieldDiff(before, updated, [
				"title",
				"description",
				"priority",
				"preferredModel",
				"tags",
				"skills",
				"mcps",
				"assignee",
			]);
			if (Object.keys(diff).length > 0) {
				await appendEvent(s, {
					entity: "task",
					entityId: id,
					groupKey: existing.groupKey,
					action: "update",
					actor,
					diff,
				});
			}
			return updated;
		});
	}

	async status(id: string, v: number, input: StatusChangeInput): Promise<TaskRow> {
		const actor = input.actor ?? "anonymous";
		const existing = await this.store.tasks.getById(id);
		if (!existing) throw notFound("task", id);
		if (existing.version !== v) {
			throw new ServiceError("VERSION_CONFLICT", "Task version mismatch", {
				currentV: existing.version,
			});
		}
		this.assertClaim(existing, actor, input.force);

		return await this.store.tx(async (s) => {
			if (input.comment) {
				await this.comments.add({
					taskId: id,
					author: actor,
					kind: input.comment.kind,
					body: input.comment.body,
					actor,
				});
			}

			const group = await s.groups.getByKey(existing.groupKey);
			const deps = await s.tasks.listDependsOn(id);
			const depsMet = await this.depsMet(s, deps);
			let reopenKind = await this.latestReopenCommentKind(s, id);
			if (
				input.to === "reopen" &&
				input.comment &&
				(input.comment.kind === "blocker" || input.comment.kind === "verification")
			) {
				reopenKind = input.comment.kind;
			}

			const transition = validateStatusTransition(existing.status, input.to, {
				hasClaim: Boolean(existing.claimOwner) || input.to === "inprogress",
				reopenCommentKind: reopenKind,
				terminalStatus: group?.terminalStatus,
				depsMet,
				depsGateEnabled: true,
				force: input.force,
				reason: input.reason,
			});

			if (!transition.ok) {
				const code =
					transition.code === "DEPS_UNMET"
						? "DEPS_UNMET"
						: transition.code === "TERMINAL_STATUS_GATE" || transition.code === "FORCE_REQUIRED"
							? "INVALID_TRANSITION"
							: transition.code === "CLAIM_REQUIRED"
								? "CLAIMED"
								: "INVALID_TRANSITION";
				throw new ServiceError(code, transition.message, {
					from: existing.status,
					to: input.to,
					blockingDeps: transition.code === "DEPS_UNMET" ? deps : undefined,
				});
			}

			let claimOwner = existing.claimOwner;
			let claimExpires = existing.claimExpires;
			if (input.to === "inprogress" && !claimOwner) {
				const leaseSeconds = 3600;
				claimOwner = actor;
				claimExpires = new Date(Date.now() + leaseSeconds * 1000).toISOString();
			}
			if (
				existing.status === "inprogress" &&
				(input.to === "open" || input.to === "todo" || input.to === "verifying")
			) {
				claimOwner = null;
				claimExpires = null;
			}

			const before = { ...existing };
			const updated = await s.tasks.update(id, {
				status: input.to,
				claimOwner,
				claimExpires,
				version: v,
			});

			await appendEvent(s, {
				entity: "task",
				entityId: id,
				groupKey: existing.groupKey,
				action: "status",
				actor,
				diff: fieldDiff(before, updated, ["status", "claimOwner", "claimExpires"]),
			});

			return updated;
		});
	}

	async move(id: string, groupKey: string, actor = "anonymous"): Promise<TaskRow> {
		const existing = await this.store.tasks.getById(id);
		if (!existing) throw notFound("task", id);
		const target = await this.store.groups.getByKey(groupKey);
		if (!target) throw notFound("group", groupKey);

		return await this.store.tx(async (s) => {
			const updated = await s.tasks.moveToGroup(id, groupKey);
			await appendEvent(s, {
				entity: "task",
				entityId: id,
				groupKey: target.key,
				action: "move",
				actor,
				diff: { group: [existing.groupKey, groupKey] },
			});
			return updated;
		});
	}

	async archive(id: string, actor = "anonymous", hard = false, reason?: string): Promise<void> {
		const existing = await this.store.tasks.getById(id);
		if (!existing) throw notFound("task", id);

		if (hard) {
			if (process.env.ALLOW_HARD_DELETE !== "1") {
				throw validation("Hard delete disabled; set ALLOW_HARD_DELETE=1");
			}
			throw validation("Hard delete not implemented");
		}

		await this.store.tx(async (s) => {
			await s.tasks.update(id, { archived: true, version: existing.version });
			await appendEvent(s, {
				entity: "task",
				entityId: id,
				groupKey: existing.groupKey,
				action: "archive",
				actor,
				diff: {
					archived: [false, true],
					...(reason ? { reason: [null, reason] as [unknown, unknown] } : {}),
				},
			});
		});
	}

	async list(query: TaskListQuery = {}): Promise<TaskListResult> {
		const limit = Math.min(query.limit ?? 20, 100);
		let tasks: TaskRow[] = [];

		if (query.q?.trim()) {
			const hits = await this.store.search({
				q: query.q,
				entity: "task",
				groupKey: query.groupKey,
				limit: 200,
			});
			for (const hit of hits) {
				const t = await this.store.tasks.getById(hit.id);
				if (t) tasks.push(t);
			}
		} else if (query.groupKey) {
			tasks = await this.store.tasks.listByGroup(query.groupKey);
		} else {
			const groups = await this.store.groups.list();
			for (const g of groups) {
				tasks.push(...(await this.store.tasks.listByGroup(g.key)));
			}
		}

		tasks = tasks.filter((t) => !t.archived);
		if (query.status?.length) {
			const set = new Set(query.status);
			tasks = tasks.filter((t) => set.has(t.status));
		}
		if (query.tags?.length) {
			tasks = tasks.filter((t) => query.tags?.every((tag) => t.tags.includes(tag)));
		}
		if (query.assignee) {
			tasks = tasks.filter((t) => t.assignee === query.assignee);
		}

		const sort = query.sort ?? "priority";
		tasks.sort((a, b) => {
			if (sort === "updated") {
				return b.updatedAt.localeCompare(a.updatedAt);
			}
			if (a.priority !== b.priority) return a.priority - b.priority;
			return a.createdAt.localeCompare(b.createdAt);
		});

		const offset = decodeCursor(query.cursor);
		const slice = tasks.slice(offset, offset + limit);
		const nextOffset = offset + limit;
		const nextCursor = nextOffset < tasks.length ? encodeCursor(nextOffset) : undefined;

		return { tasks: slice, nextCursor };
	}

	private assertClaim(task: TaskRow, actor: string, force?: boolean): void {
		if (!task.claimOwner || task.claimOwner === actor || force) return;
		const expires = task.claimExpires ? Date.parse(task.claimExpires) : 0;
		if (expires > Date.now()) {
			throw new ServiceError("CLAIMED", "Task is claimed by another agent", {
				owner: task.claimOwner,
				expiresAt: task.claimExpires,
			});
		}
	}

	private conflictFields(task: TaskRow, patch: TaskUpdatePatch): string[] {
		const fields: string[] = [];
		if (patch.set?.title !== undefined && patch.set.title !== task.title) fields.push("title");
		if (patch.set?.description !== undefined && patch.set.description !== task.description) {
			fields.push("description");
		}
		if (patch.set?.priority !== undefined && patch.set.priority !== task.priority) {
			fields.push("priority");
		}
		return fields.length ? fields : ["version"];
	}

	private async depsMet(s: Store, depIds: string[]): Promise<boolean> {
		for (const id of depIds) {
			const dep = await s.tasks.getById(id);
			if (!dep || (dep.status !== "verified" && dep.status !== "deployed")) {
				return false;
			}
		}
		return true;
	}

	private async latestReopenCommentKind(
		s: Store,
		taskId: string,
	): Promise<ReopenCommentKind | null> {
		const comments = await s.comments.listByTask(taskId);
		for (const c of [...comments].reverse()) {
			if (c.compactedInto) continue;
			if (c.kind === "blocker" || c.kind === "verification") {
				return c.kind;
			}
		}
		return null;
	}
}

function applyListOps(base: string[], add?: string[], remove?: string[]): string[] {
	const set = new Set(base);
	for (const r of remove ?? []) set.delete(r);
	for (const a of add ?? []) set.add(a);
	return [...set];
}

function encodeCursor(offset: number): string {
	return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

function decodeCursor(cursor?: string): number {
	if (!cursor) return 0;
	try {
		const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString()) as { o?: number };
		return typeof parsed.o === "number" ? parsed.o : 0;
	} catch {
		return 0;
	}
}
