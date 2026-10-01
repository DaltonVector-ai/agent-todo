import type { Store } from "../store/Store.js";
import type { CommentRow } from "../store/types.js";
import { notFound, validation } from "./errors.js";
import { appendEvent } from "./eventLog.js";

export const COMMENT_KINDS = [
	"note",
	"question",
	"decision",
	"handoff",
	"verification",
	"blocker",
	"summary",
] as const;

export type CommentKind = (typeof COMMENT_KINDS)[number];

const LIVE_COMMENT_THRESHOLD = 15;
const LIVE_TOKEN_THRESHOLD = 3000;

export type AddCommentInput = {
	taskId: string;
	author: string;
	kind: CommentKind;
	body: string;
	summary?: string;
	pinned?: boolean;
	replyTo?: string;
	actor?: string;
};

export type AddCommentResult = {
	comment: CommentRow;
	decisionHint?: string;
	needsCompaction: boolean;
};

export type ListCommentsOpts = {
	sinceId?: string;
	kinds?: CommentKind[];
	ids?: string[];
	includeCompacted?: boolean;
};

export type CompactCommentsInput = {
	taskId: string;
	summaryBody: string;
	author?: string;
	keepPinned?: boolean;
	includeDecisions?: boolean;
	supersedes?: string[] | "all";
	actor?: string;
};

export class CommentService {
	constructor(private readonly store: Store) {}

	async add(input: AddCommentInput): Promise<AddCommentResult> {
		const actor = input.actor ?? input.author;
		if (!COMMENT_KINDS.includes(input.kind)) {
			throw validation(`Invalid comment kind: ${input.kind}`);
		}

		return await this.store.tx(async (s) => {
			const task = await s.tasks.getById(input.taskId);
			if (!task) throw notFound("task", input.taskId);

			let replyToPk: string | null = null;
			if (input.replyTo) {
				const reply = await s.comments.getById(input.replyTo);
				if (!reply || reply.taskId !== input.taskId) {
					throw validation("reply_to must reference a comment on the same task");
				}
				replyToPk = reply.pk;
			}

			const summary =
				input.summary?.slice(0, 160) ??
				input.body.split("\n")[0]?.slice(0, 160) ??
				input.body.slice(0, 160);

			const comment = await s.comments.create({
				taskId: input.taskId,
				author: input.author,
				kind: input.kind,
				body: input.body,
				summary,
				pinned: input.pinned,
				replyToPk,
			});

			await appendEvent(s, {
				entity: "comment",
				entityId: comment.id,
				groupKey: task.groupKey,
				action: "create",
				actor,
				diff: { kind: [null, comment.kind] },
			});

			const live = await this.liveComments(s, input.taskId);
			const needsCompaction = this.needsCompactionFlag(live);

			const decisionHint =
				input.kind === "decision"
					? `consider context_update ${task.groupKey} decisions append`
					: undefined;

			return { comment, decisionHint, needsCompaction };
		});
	}

	async list(taskId: string, opts: ListCommentsOpts = {}): Promise<CommentRow[]> {
		const all = await this.store.comments.listByTask(taskId);
		let rows = all;

		if (!opts.includeCompacted) {
			rows = rows.filter((c) => !c.compactedInto);
		}
		if (opts.kinds?.length) {
			const kinds = new Set(opts.kinds);
			rows = rows.filter((c) => kinds.has(c.kind as CommentKind));
		}
		if (opts.ids?.length) {
			const ids = new Set(opts.ids);
			rows = rows.filter((c) => ids.has(c.id));
		}
		if (opts.sinceId) {
			const since = all.find((c) => c.id === opts.sinceId);
			if (since) {
				rows = rows.filter((c) => c.seq > since.seq);
			}
		}
		return rows;
	}

	needsCompactionFlag(comments: CommentRow[]): boolean {
		const live = comments.filter((c) => !c.compactedInto);
		const tokens = live.reduce((sum, c) => sum + c.tokens, 0);
		return live.length > LIVE_COMMENT_THRESHOLD || tokens > LIVE_TOKEN_THRESHOLD;
	}

	async compact(input: CompactCommentsInput): Promise<{ comment: CommentRow; hidden: number }> {
		const actor = input.actor ?? input.author ?? "system";
		const keepPinned = input.keepPinned ?? true;
		const includeDecisions = input.includeDecisions ?? false;

		return await this.store.tx(async (s) => {
			const task = await s.tasks.getById(input.taskId);
			if (!task) throw notFound("task", input.taskId);

			const all = await s.comments.listByTask(input.taskId);
			const supersedes = input.supersedes ?? "all";
			const idSet = supersedes === "all" ? null : new Set(supersedes);
			const toCompact = all.filter((c) => {
				if (c.compactedInto) return false;
				if (c.kind === "summary") return false;
				if (idSet && !idSet.has(c.id)) return false;
				if (keepPinned && c.pinned) return false;
				if (!includeDecisions && c.kind === "decision") return false;
				return true;
			});

			const summaryComment = await s.comments.create({
				taskId: input.taskId,
				author: input.author ?? "system",
				kind: "summary",
				body: input.summaryBody,
			});

			for (const c of toCompact) {
				await s.comments.update(c.id, { compactedInto: summaryComment.id });
			}

			await appendEvent(s, {
				entity: "comment",
				entityId: summaryComment.id,
				groupKey: task.groupKey,
				action: "compact",
				actor,
				diff: { compacted: [toCompact.length, summaryComment.id] },
			});

			return { comment: summaryComment, hidden: toCompact.length };
		});
	}

	private async liveComments(s: Store, taskId: string): Promise<CommentRow[]> {
		const all = await s.comments.listByTask(taskId);
		return all.filter((c) => !c.compactedInto);
	}
}
