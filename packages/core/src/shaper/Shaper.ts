import type { WorkBundle } from "../services/WorkService.js";
import { ServiceError } from "../services/errors.js";
import type { CommentRow, EventRow, SectionRow, TaskRow } from "../store/types.js";
import { estimate, truncate } from "../util/tokens.js";
import { encodeCursor } from "./cursors.js";
import { toJsonString } from "./renderJson.js";
import {
	renderCommentLine,
	renderContextSections,
	renderContextToc,
	renderEventLine,
	renderNone,
	renderTaskLine,
	renderTaskListHeader,
	renderWorkBundleText,
} from "./renderText.js";
import {
	type CommentDigest,
	type DetailView,
	commentDigest,
	omitEmpty,
	shapeTaskRow,
} from "./views.js";

export type OutputFormat = "text" | "json";

export type ReadShapeOpts = {
	view?: DetailView;
	fields?: string[];
	maxTokens?: number;
	format?: OutputFormat;
};

export type ListShapeOpts = ReadShapeOpts & {
	limit?: number;
	cursor?: string;
};

export type ShaperResult = {
	text: string;
	structured?: Record<string, unknown> | unknown[];
	truncated?: boolean;
};

export type WriteAck = {
	id: string;
	v?: number;
	status?: string;
	warnings?: string[];
};

const HARD_CAP = 50_000;

export class Shaper {
	constructor(private readonly defaultMaxTokens = 2000) {}

	renderRead(
		payload: Record<string, unknown> | unknown[] | string,
		opts: ReadShapeOpts = {},
	): ShaperResult {
		const format = opts.format ?? "text";
		const maxTokens = opts.maxTokens ?? this.defaultMaxTokens;
		if (format === "json") {
			const json = toJsonString(payload);
			return this.applyBudget(json, maxTokens, () => ({
				structured: payload as Record<string, unknown>,
			}));
		}
		const text = typeof payload === "string" ? payload : JSON.stringify(payload);
		return this.applyBudget(text, maxTokens);
	}

	renderTaskList(
		opts: ListShapeOpts & {
			groupKey?: string;
			rev: number;
			openCount: number;
			total: number;
			tasks: TaskRow[];
			digests?: Map<string, CommentDigest>;
			nextCursor?: string;
		},
	): ShaperResult {
		const view = opts.view ?? "line";
		const format = opts.format ?? "text";
		const maxTokens = opts.maxTokens ?? this.defaultMaxTokens;

		if (format === "json") {
			const items = opts.tasks.map((t) =>
				shapeTaskRow(t, view, opts.digests?.get(t.id), opts.fields),
			);
			const structured = omitEmpty({
				rev: opts.rev,
				group: opts.groupKey,
				tasks: items,
				next: opts.nextCursor,
			});
			return this.renderRead(structured, { format: "json", maxTokens });
		}

		const lines: string[] = [];
		if (opts.groupKey) {
			lines.push(renderTaskListHeader(opts.groupKey, opts.rev, opts.openCount, opts.total));
		} else {
			lines.push(`rev=${opts.rev}`);
		}

		let used = estimate(lines.join("\n"));
		for (const task of opts.tasks) {
			const digest = opts.digests?.get(task.id);
			const line =
				view === "line"
					? renderTaskLine(task, digest)
					: JSON.stringify(shapeTaskRow(task, view, digest, opts.fields));
			const cost = estimate(line) + 1;
			if (used + cost > maxTokens) {
				const offset = opts.tasks.indexOf(task);
				const next = encodeCursor(offset);
				lines.push(`next: ${next}`);
				break;
			}
			lines.push(line);
			used += cost;
		}
		if (opts.nextCursor && !lines.some((l) => l.startsWith("next:"))) {
			lines.push(`next: ${opts.nextCursor}`);
		}

		return { text: lines.join("\n") };
	}

	renderTaskGet(
		task: TaskRow,
		opts: ReadShapeOpts & { digest?: CommentDigest; extras?: Record<string, unknown> },
	): ShaperResult {
		const view = opts.view ?? "brief";
		const shaped = shapeTaskRow(task, view, opts.digest, opts.fields);
		const payload = { ...shaped, ...opts.extras, rev: opts.extras?.rev };
		return this.renderRead(omitEmpty(payload as Record<string, unknown>), opts);
	}

	renderWorkBundle(bundle: WorkBundle, rev: number, opts: ReadShapeOpts = {}): ShaperResult {
		const format = opts.format ?? "text";
		const digest = commentDigest([
			...bundle.comments.pinned,
			...bundle.comments.recent,
		]);
		const taskShape = shapeTaskRow(bundle.task, "full", digest, opts.fields);

		if (format === "json") {
			const structured = {
				rev,
				task: taskShape,
				comments: {
					pinned: bundle.comments.pinned.map((c) => c.summary || c.body.slice(0, 160)),
					recent: bundle.comments.recent.map((c) => c.summary || c.body.slice(0, 160)),
				},
				context: bundle.context,
			};
			return this.renderRead(structured, { ...opts, format: "json", view: "full" });
		}

		const parts = [
			`rev=${rev}`,
			renderTaskLine(bundle.task, digest),
			`--- ${bundle.task.id} (full) ---`,
			bundle.task.description,
		];
		for (const c of bundle.comments.pinned) {
			parts.push(`pin: ${renderCommentLine(c, "summary")}`);
		}
		for (const c of bundle.comments.recent) {
			parts.push(renderCommentLine(c, "summary"));
		}
		for (const s of bundle.context.sections) {
			parts.push(`## ${s.title}\n${s.body}`);
		}
		return this.renderRead(renderWorkBundleText(parts), opts);
	}

	renderComments(
		comments: CommentRow[],
		opts: ReadShapeOpts & { view?: "summary" | "full" },
	): ShaperResult {
		const view = opts.view ?? "summary";
		const format = opts.format ?? "text";
		if (format === "json") {
			const items = comments.map((c) =>
				view === "full"
					? { id: c.id, kind: c.kind, author: c.author, body: c.body }
					: { id: c.id, kind: c.kind, summary: c.summary },
			);
			return this.renderRead({ comments: items }, { ...opts, format: "json" });
		}
		const text = comments.map((c) => renderCommentLine(c, view)).join("\n");
		return this.renderRead(text, opts);
	}

	renderContext(
		groupKey: string,
		toc: Array<{ slug: string; title: string; tokens: number; alwaysInclude: boolean }>,
		sections: SectionRow[],
		opts: ReadShapeOpts,
	): ShaperResult {
		const format = opts.format ?? "text";
		if (format === "json") {
			const structured = sections.length
				? { group: groupKey, sections }
				: { group: groupKey, toc };
			return this.renderRead(structured, { ...opts, format: "json" });
		}
		const text = sections.length
			? renderContextSections(sections)
			: renderContextToc(groupKey, toc);
		return this.renderRead(text, opts);
	}

	renderChanges(
		rev: number,
		events: EventRow[],
		opts: ReadShapeOpts,
	): ShaperResult {
		const format = opts.format ?? "text";
		if (format === "json") {
			return this.renderRead({ rev, events }, { ...opts, format: "json" });
		}
		const lines = [`rev=${rev}`, ...events.map(renderEventLine)];
		return this.renderRead(lines.join("\n"), opts);
	}

	renderWriteAck(ack: WriteAck, echo?: Record<string, unknown>, opts?: ReadShapeOpts): ShaperResult {
		const format = opts?.format ?? "text";
		const base = omitEmpty({
			id: ack.id,
			v: ack.v,
			status: ack.status,
			warnings: ack.warnings,
		});
		if (echo) Object.assign(base, echo);
		if (format === "json") {
			return { text: toJsonString(base), structured: base };
		}
		const parts = [ack.id];
		if (ack.v !== undefined) parts.push(`v=${ack.v}`);
		if (ack.status) parts.push(`status=${ack.status}`);
		if (ack.warnings?.length) parts.push(`warnings=${ack.warnings.join(";")}`);
		return { text: parts.join(" ") };
	}

	renderNoneResult(opts?: ReadShapeOpts): ShaperResult {
		if (opts?.format === "json") {
			return { text: '{"none":true}', structured: { none: true } };
		}
		return { text: renderNone() };
	}

	toMcpContent(result: ShaperResult): {
		content: Array<{ type: "text"; text: string }>;
		structuredContent?: Record<string, unknown>;
	} {
		const out: {
			content: Array<{ type: "text"; text: string }>;
			structuredContent?: Record<string, unknown>;
		} = { content: [{ type: "text", text: result.text }] };
		if (result.structured && !Array.isArray(result.structured)) {
			out.structuredContent = result.structured;
		}
		return out;
	}

	private applyBudget(
		text: string,
		maxTokens: number,
		jsonFactory?: () => { structured?: Record<string, unknown> | unknown[] },
	): ShaperResult {
		if (estimate(text) > HARD_CAP) {
			throw new ServiceError("BUDGET", "Response exceeds hard token cap", {
				tokens: estimate(text),
				hint: "use view=brief fields=[…] or lower limit",
			});
		}
		const { text: trimmed, truncated } = truncate(text, maxTokens);
		if (truncated && jsonFactory) {
			return {
				text: trimmed,
				structured: jsonFactory().structured,
				truncated: true,
			};
		}
		return { text: trimmed, truncated };
	}
}
