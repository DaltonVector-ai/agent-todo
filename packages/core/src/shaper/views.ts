import type { CommentRow, TaskRow } from "../store/types.js";

export type DetailView = "id" | "line" | "brief" | "full";

export type CommentDigest = {
	n: number;
	pinned: string[];
	last?: string;
};

export function commentDigest(comments: CommentRow[]): CommentDigest {
	const live = comments.filter((c) => !c.compactedInto);
	const pinned = live.filter((c) => c.pinned).map((c) => c.summary || c.body.slice(0, 80));
	const last = live.at(-1);
	const lastLine = last
		? `${last.id} ${last.kind === "handoff" ? "handoff: " : ""}${last.summary || last.body.slice(0, 80)}`
		: undefined;
	return { n: live.length, pinned, last: lastLine };
}

export function omitEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v === null || v === undefined) continue;
		if (v === "") continue;
		if (Array.isArray(v) && v.length === 0) continue;
		out[k] = v;
	}
	return out as Partial<T>;
}

export function projectFields<T extends Record<string, unknown>>(
	obj: T,
	fields?: string[],
): Partial<T> {
	if (!fields?.length) return omitEmpty(obj);
	const out: Record<string, unknown> = {};
	for (const f of fields) {
		if (f in obj) out[f] = obj[f];
	}
	return out as Partial<T>;
}

export function shapeTaskRow(
	task: TaskRow,
	view: DetailView,
	digest?: CommentDigest,
	fields?: string[],
): Record<string, unknown> {
	if (view === "id") {
		return projectFields({ id: task.id }, fields);
	}

	const base: Record<string, unknown> = {
		id: task.id,
		group: task.groupKey,
		status: task.status,
		v: task.version,
	};

	if (view === "line") {
		return projectFields(base, fields);
	}

	base.title = task.title;
	base.priority = task.priority;
	if (task.preferredModel) base.model = task.preferredModel;
	if (task.skills.length) base.skills = task.skills;
	if (task.tags.length) base.tags = task.tags;
	if (task.assignee) base.assignee = task.assignee;
	if (task.commentCount) base.commentCount = task.commentCount;
	if (digest) base.comments = digest;

	if (view === "full") {
		base.description = task.description;
		if (task.mcps.length) base.mcps = task.mcps;
		if (task.acceptance.length) base.acceptance = task.acceptance;
		if (task.claimOwner) {
			base.claimOwner = task.claimOwner;
			base.claimExpires = task.claimExpires;
		}
	}

	return projectFields(base, fields);
}
