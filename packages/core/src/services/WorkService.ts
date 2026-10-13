import type { Store } from "../store/Store.js";
import type { CommentRow, TaskRow } from "../store/types.js";
import { CommentService } from "./CommentService.js";
import { ContextService } from "./ContextService.js";
import { notFound, ServiceError, validation } from "./errors.js";
import { appendEvent } from "./eventLog.js";

export type WorkBundle = {
	task: TaskRow;
	comments: {
		pinned: CommentRow[];
		recent: CommentRow[];
	};
	context: Awaited<ReturnType<ContextService["forTask"]>>;
};

export type NextOptions = {
	groupKey?: string;
	tags?: string[];
	model?: string;
	skills?: string[];
	owner: string;
	ttlMinutes?: number;
	claim?: boolean;
};

export class WorkService {
	private readonly context: ContextService;
	private readonly comments: CommentService;

	constructor(private readonly store: Store) {
		this.context = new ContextService(store);
		this.comments = new CommentService(store);
	}

	async next(opts: NextOptions): Promise<WorkBundle | null> {
		const claim = opts.claim ?? true;
		const leaseSeconds = (opts.ttlMinutes ?? 60) * 60;

		const task = claim
			? await this.store.claimNext({
					groupKey: opts.groupKey,
					owner: opts.owner,
					leaseSeconds,
					tags: opts.tags,
					preferredModel: opts.model,
					skills: opts.skills,
				})
			: await this.pickUnclaimed(opts);

		if (!task) return null;

		if (claim) {
			await this.store.events.append({
				entity: "task",
				entityId: task.id,
				groupKey: task.groupKey,
				action: "claim",
				actor: opts.owner,
				diff: { status: ["open", "inprogress"] },
			});
		}

		return await this.buildBundle(task);
	}

	async claim(taskId: string, owner: string, ttlMinutes = 60, actor?: string): Promise<TaskRow> {
		const existing = await this.store.tasks.getById(taskId);
		if (!existing) throw notFound("task", taskId);
		if (
			existing.claimOwner &&
			existing.claimOwner !== owner &&
			existing.claimExpires &&
			Date.parse(existing.claimExpires) > Date.now()
		) {
			throw new ServiceError("CLAIMED", "Task already claimed", {
				owner: existing.claimOwner,
				expiresAt: existing.claimExpires,
			});
		}
		if (existing.status !== "open" && existing.status !== "reopen") {
			throw new ServiceError("INVALID_TRANSITION", "Only open/reopen tasks can be claimed");
		}

		const expires = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
		return await this.store.tx(async (s) => {
			const updated = await s.tasks.update(taskId, {
				status: "inprogress",
				claimOwner: owner,
				claimExpires: expires,
				version: existing.version,
			});
			await appendEvent(s, {
				entity: "task",
				entityId: taskId,
				groupKey: existing.groupKey,
				action: "claim",
				actor: actor ?? owner,
				diff: { claimOwner: [existing.claimOwner, owner] },
			});
			return updated;
		});
	}

	async release(
		taskId: string,
		owner: string,
		opts: { toStatus?: "open" | "todo"; actor?: string } = {},
	): Promise<TaskRow> {
		const existing = await this.store.tasks.getById(taskId);
		if (!existing) throw notFound("task", taskId);
		if (existing.claimOwner && existing.claimOwner !== owner) {
			throw new ServiceError("CLAIMED", "Only claim owner can release", {
				owner: existing.claimOwner,
			});
		}

		const toStatus = opts.toStatus ?? "open";
		if (toStatus !== "open" && toStatus !== "todo") {
			throw validation("to_status must be open or todo");
		}

		return await this.store.tx(async (s) => {
			const updated = await s.tasks.update(taskId, {
				status: toStatus,
				claimOwner: null,
				claimExpires: null,
				version: existing.version,
			});
			await appendEvent(s, {
				entity: "task",
				entityId: taskId,
				groupKey: existing.groupKey,
				action: "release",
				actor: opts.actor ?? owner,
				diff: { status: [existing.status, toStatus] },
			});
			return updated;
		});
	}

	async extend(taskId: string, owner: string, ttlMinutes = 60, actor?: string): Promise<TaskRow> {
		const existing = await this.store.tasks.getById(taskId);
		if (!existing) throw notFound("task", taskId);
		if (existing.claimOwner !== owner) {
			throw new ServiceError("CLAIMED", "Only claim owner can extend lease", {
				owner: existing.claimOwner,
			});
		}
		const expires = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
		return await this.store.tx(async (s) => {
			const updated = await s.tasks.update(taskId, {
				claimExpires: expires,
				version: existing.version,
			});
			await appendEvent(s, {
				entity: "task",
				entityId: taskId,
				groupKey: existing.groupKey,
				action: "extend",
				actor: actor ?? owner,
				diff: { claimExpires: [existing.claimExpires, expires] },
			});
			return updated;
		});
	}

	async sweepExpiredClaims(actor = "system"): Promise<number> {
		const groups = await this.store.groups.list({ includeArchived: true });
		let swept = 0;
		const now = Date.now();

		for (const group of groups) {
			const tasks = await this.store.tasks.listByGroup(group.key, { includeArchived: true });
			for (const task of tasks) {
				if (task.status !== "inprogress" || !task.claimExpires) continue;
				if (Date.parse(task.claimExpires) > now) continue;

				await this.store.tx(async (s) => {
					await s.tasks.update(task.id, {
						status: "open",
						claimOwner: null,
						claimExpires: null,
						version: task.version,
					});
					await s.comments.create({
						taskId: task.id,
						author: "system",
						kind: "note",
						body: `claim expired (${task.claimOwner ?? "unknown"})`,
					});
					await appendEvent(s, {
						entity: "task",
						entityId: task.id,
						groupKey: task.groupKey,
						action: "claim_expired",
						actor,
						diff: { status: ["inprogress", "open"] },
					});
				});
				swept += 1;
			}
		}
		return swept;
	}

	private async buildBundle(task: TaskRow): Promise<WorkBundle> {
		const all = await this.comments.list(task.id, { includeCompacted: false });
		const pinned = all.filter((c) => c.pinned);
		const unpinned = all.filter((c) => !c.pinned);
		const recent = unpinned.slice(-3);
		const context = await this.context.forTask(task);
		return { task, comments: { pinned, recent }, context };
	}

	private async pickUnclaimed(opts: NextOptions): Promise<TaskRow | null> {
		return await this.store.peekNextOpen({
			groupKey: opts.groupKey,
			owner: opts.owner,
			tags: opts.tags,
			preferredModel: opts.model,
			skills: opts.skills,
		});
	}
}
