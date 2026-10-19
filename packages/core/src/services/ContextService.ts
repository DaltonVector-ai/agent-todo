import { formatSectionId } from "../domain/ids.js";
import type { Store } from "../store/Store.js";
import type { SectionRow, TaskRow } from "../store/types.js";
import { estimate } from "../util/tokens.js";
import { notFound, ServiceError, validation } from "./errors.js";
import { appendEvent, fieldDiff } from "./eventLog.js";

export type ContextTocEntry = {
	id: string;
	slug: string;
	title: string;
	tokens: number;
	alwaysInclude: boolean;
	appliesTo: string[];
};

export type ContextOp =
	| {
			op: "upsert";
			slug: string;
			title: string;
			body?: string;
			alwaysInclude?: boolean;
			appliesTo?: string[];
	  }
	| { op: "append"; slug: string; body: string }
	| { op: "replace_text"; slug: string; find: string; replace: string }
	| { op: "delete"; slug: string }
	| { op: "move"; slug: string; position: number };

export type ForTaskResult = {
	sections: SectionRow[];
	overflow: Array<{ id: string; slug: string; tokens: number }>;
	tokenBudget: number;
	tokensUsed: number;
};

export type ImportMarkdownResult = {
	sections: SectionRow[];
	largeSections: string[];
};

export type ContextExportFlavor = "claude_md" | "agents_md" | "plain" | "stub";

export type ImportMarkdownMode = "merge" | "replace";

function slugifyHeading(title: string): string {
	return title
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/^$/, "section");
}

export class ContextService {
	constructor(private readonly store: Store) {}

	async toc(groupKey: string): Promise<ContextTocEntry[]> {
		const sections = await this.store.sections.listByGroup(groupKey);
		return sections.map((s) => ({
			id: formatSectionId(groupKey, s.slug),
			slug: s.slug,
			title: s.title,
			tokens: s.tokens,
			alwaysInclude: s.alwaysInclude,
			appliesTo: s.appliesTo,
		}));
	}

	async getSections(groupKey: string, slugs: string[]): Promise<SectionRow[]> {
		const all = await this.store.sections.listByGroup(groupKey);
		const want = new Set(slugs);
		return all.filter((s) => want.has(s.slug));
	}

	async applyOps(
		groupKey: string,
		ops: ContextOp[],
		opts: { v?: number; actor?: string } = {},
	): Promise<SectionRow[]> {
		const actor = opts.actor ?? "anonymous";
		const group = await this.store.groups.getByKey(groupKey);
		if (!group) throw notFound("group", groupKey);

		return await this.store.tx(async (s) => {
			const updated: SectionRow[] = [];
			for (const op of ops) {
				const sectionId = formatSectionId(groupKey, op.slug);
				if (op.op === "upsert") {
					const existing = await s.sections.getById(sectionId);
					if (existing) {
						if (opts.v !== undefined && existing.version !== opts.v) {
							throw new ServiceError("VERSION_CONFLICT", "Section version mismatch", {
								slug: op.slug,
								currentV: existing.version,
							});
						}
						const before = { ...existing };
						const row = await s.sections.update(sectionId, {
							title: op.title,
							body: op.body,
							alwaysInclude: op.alwaysInclude,
							appliesTo: op.appliesTo,
							version: existing.version,
						});
						await appendEvent(s, {
							entity: "context_section",
							entityId: sectionId,
							groupKey,
							action: "update",
							actor,
							diff: fieldDiff(before, row, ["title", "body", "alwaysInclude", "appliesTo"]),
						});
						updated.push(row);
					} else {
						const position = (await s.sections.listByGroup(groupKey)).length;
						const row = await s.sections.create({
							groupKey,
							slug: op.slug,
							title: op.title,
							body: op.body ?? "",
							position,
							alwaysInclude: op.alwaysInclude,
							appliesTo: op.appliesTo,
						});
						await appendEvent(s, {
							entity: "context_section",
							entityId: sectionId,
							groupKey,
							action: "create",
							actor,
							diff: { slug: [null, op.slug] },
						});
						updated.push(row);
					}
					continue;
				}

				const existing = await s.sections.getById(sectionId);
				if (!existing) throw notFound("section", sectionId);

				if (op.op === "append") {
					const body = `${existing.body}\n${op.body}`.trim();
					const row = await s.sections.update(sectionId, {
						body,
						version: existing.version,
					});
					updated.push(row);
				} else if (op.op === "replace_text") {
					if (!existing.body.includes(op.find)) {
						throw validation("find text not found in section", { slug: op.slug });
					}
					const body = existing.body.replace(op.find, op.replace);
					const row = await s.sections.update(sectionId, { body, version: existing.version });
					updated.push(row);
				} else if (op.op === "delete") {
					await s.sections.update(sectionId, {
						body: "",
						title: existing.title,
						version: existing.version,
					});
					const row = mustSection(await s.sections.getById(sectionId));
					updated.push(row);
				} else if (op.op === "move") {
					const row = await s.sections.update(sectionId, {
						position: op.position,
						version: existing.version,
					});
					updated.push(row);
				}
			}
			return updated;
		});
	}

	async forTask(task: TaskRow, tokenBudget = 1500): Promise<ForTaskResult> {
		const sections = await this.store.sections.listByGroup(task.groupKey);
		const tagSet = new Set(task.tags);
		const selected: SectionRow[] = [];
		const overflow: Array<{ id: string; slug: string; tokens: number }> = [];
		let tokensUsed = 0;

		const candidates = sections.filter(
			(s) => s.alwaysInclude || s.appliesTo.some((t) => tagSet.has(t)),
		);

		for (const s of candidates) {
			if (tokensUsed + s.tokens <= tokenBudget) {
				selected.push(s);
				tokensUsed += s.tokens;
			} else {
				overflow.push({
					id: formatSectionId(task.groupKey, s.slug),
					slug: s.slug,
					tokens: s.tokens,
				});
			}
		}

		return { sections: selected, overflow, tokenBudget, tokensUsed };
	}

	async importMarkdown(
		groupKey: string,
		markdown: string,
		actor = "anonymous",
		opts: { mode?: ImportMarkdownMode } = {},
	): Promise<ImportMarkdownResult> {
		const group = await this.store.groups.getByKey(groupKey);
		if (!group) throw notFound("group", groupKey);

		const mode = opts.mode ?? "merge";
		const parts = markdown.split(/^##\s+/m).filter((p) => p.trim().length > 0);
		const largeSections: string[] = [];
		const sections: SectionRow[] = [];
		const importedSlugs = new Set<string>();

		await this.store.tx(async (s) => {
			const existing = await s.sections.listByGroup(groupKey);
			if (mode === "replace") {
				for (const sec of existing) {
					await s.sections.update(formatSectionId(groupKey, sec.slug), {
						body: "",
						title: sec.title,
						version: sec.version,
					});
				}
			}

			let position = existing.length;
			for (const part of parts) {
				const lines = part.split("\n");
				const title = lines[0]?.trim() ?? "Section";
				const body = lines.slice(1).join("\n").trim();
				const slug = slugifyHeading(title);
				importedSlugs.add(slug);
				if (estimate(body) > 800) {
					largeSections.push(slug);
				}
				const sectionId = formatSectionId(groupKey, slug);
				const prev = await s.sections.getById(sectionId);
				let row: SectionRow;
				if (prev) {
					row = await s.sections.update(sectionId, {
						title,
						body,
						version: prev.version,
					});
				} else {
					row = await s.sections.create({
						groupKey,
						slug,
						title,
						body,
						position,
					});
					position += 1;
				}
				sections.push(row);
				await appendEvent(s, {
					entity: "context_section",
					entityId: sectionId,
					groupKey,
					action: "import",
					actor,
					diff: { slug: [null, slug] },
				});
			}

			if (mode === "replace") {
				for (const sec of existing) {
					if (importedSlugs.has(sec.slug)) continue;
					await s.sections.update(formatSectionId(groupKey, sec.slug), {
						body: "",
						title: sec.title,
						version: sec.version,
					});
				}
			}
		});

		return { sections, largeSections };
	}

	async exportMarkdown(
		groupKey: string,
		flavor: ContextExportFlavor,
		sectionSlugs?: string[],
	): Promise<string> {
		const group = await this.store.groups.getByKey(groupKey);
		if (!group) throw notFound("group", groupKey);

		if (flavor === "stub") {
			const projectCode = group?.projectCode ?? groupKey.replace(/-\d+$/, "");
			return `Project context lives in agent-todo group ${groupKey}. Call \`context_get ${groupKey}\` for the index; call \`task_next project=${projectCode}\` to start work (pass \`group\` only to stay inside one feature).`;
		}

		let sections = await this.store.sections.listByGroup(groupKey);
		sections = sections.filter((s) => s.body.trim().length > 0);
		if (sectionSlugs?.length) {
			const want = new Set(sectionSlugs);
			sections = sections.filter((s) => want.has(s.slug));
		}

		const body = sections.map((s) => `## ${s.title}\n${s.body}`).join("\n\n");
		if (flavor === "plain") {
			return body;
		}

		const filename =
			flavor === "agents_md" ? "AGENTS.md" : flavor === "claude_md" ? "CLAUDE.md" : "context.md";
		const header = `<!-- Generated by agent-todo context_export (${filename}) — edit via MCP context_update -->\n\n`;
		return header + body;
	}
}

function mustSection(s: SectionRow | null): SectionRow {
	if (!s) throw new Error("section missing");
	return s;
}
