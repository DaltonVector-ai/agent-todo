import type { CommentRow, EventRow, SectionRow, TaskRow } from "../store/types.js";
import type { CommentDigest } from "./views.js";

export function renderTaskLine(task: TaskRow, digest?: CommentDigest): string {
	const parts = [
		task.id,
		`[${task.status}]`,
		`P${task.priority}`,
		task.title,
	];
	if (task.preferredModel) parts.push(task.preferredModel);
	if (task.skills.length) parts.push(`skills:${task.skills.join(",")}`);
	const n = digest?.n ?? task.commentCount;
	if (n > 0) {
		const blocker = digest && hasBlockerHint(digest) ? "!blocker" : "";
		parts.push(`${n}c${blocker}`);
	}
	return parts.join(" ");
}

function hasBlockerHint(digest: CommentDigest): boolean {
	return digest.last?.includes("blocker") ?? false;
}

export function renderTaskListHeader(
	groupKey: string,
	rev: number,
	openCount: number,
	total: number,
): string {
	return `${groupKey} rev=${rev} · ${openCount} of ${total} open`;
}

export function renderCommentLine(c: CommentRow, view: "summary" | "full"): string {
	if (view === "full") {
		return `${c.id} [${c.kind}] ${c.author}: ${c.body}`;
	}
	return `${c.id} [${c.kind}] ${c.summary || c.body.slice(0, 120)}`;
}

export function renderEventLine(e: EventRow): string {
	return `rev${e.rev} ${e.entity}/${e.entityId} ${e.action} by ${e.actor}`;
}

export function renderContextToc(
	groupKey: string,
	entries: Array<{ slug: string; title: string; tokens: number; alwaysInclude: boolean }>,
): string {
	const lines = entries.map(
		(e) => `${e.slug} (${e.tokens} tok)${e.alwaysInclude ? " *" : ""} — ${e.title}`,
	);
	return `${groupKey} context TOC\n${lines.join("\n")}`;
}

export function renderContextSections(sections: SectionRow[]): string {
	return sections.map((s) => `## ${s.title}\n${s.body}`).join("\n\n");
}

export function renderWorkBundleText(parts: string[]): string {
	return parts.join("\n");
}

export function renderNone(): string {
	return "none";
}
