const GROUP_KEY_RE = /^[A-Z][A-Z0-9]{1,7}$/;
const TASK_ID_RE = /^([A-Z][A-Z0-9]{1,7})-(\d+)$/;
const COMMENT_ID_RE = /^(.+)#(\d+)$/;
const SECTION_ID_RE = /^([A-Z][A-Z0-9]{1,7})\/([a-z0-9][a-z0-9-]*)$/;

export function isGroupKey(s: string): boolean {
	return GROUP_KEY_RE.test(s);
}

/** Uppercase alnum slug; pad/truncate to 2–8 chars starting with a letter. */
export function deriveKeyFromName(name: string): string {
	const slug = name
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "")
		.replace(/^[^A-Z]+/, "");
	let key = slug.slice(0, 8);
	if (key.length < 2) {
		key = `${key || "G"}X`.slice(0, 2);
	}
	if (!/^[A-Z]/.test(key)) {
		key = `G${key}`.slice(0, 8);
	}
	return key;
}

export function parseTaskId(s: string): { key: string; n: number } | null {
	const m = TASK_ID_RE.exec(s);
	if (!m?.[1] || !m[2]) return null;
	return { key: m[1], n: Number.parseInt(m[2], 10) };
}

export function formatTaskId(key: string, n: number): string {
	return `${key}-${n}`;
}

export function formatCommentId(taskId: string, seq: number): string {
	return `${taskId}#${seq}`;
}

export function parseCommentId(s: string): { taskId: string; seq: number } | null {
	const m = COMMENT_ID_RE.exec(s);
	if (!m?.[1] || !m[2]) return null;
	return { taskId: m[1], seq: Number.parseInt(m[2], 10) };
}

export function formatSectionId(key: string, slug: string): string {
	return `${key}/${slug}`;
}

export function parseSectionId(s: string): { key: string; slug: string } | null {
	const m = SECTION_ID_RE.exec(s);
	if (!m?.[1] || !m[2]) return null;
	return { key: m[1], slug: m[2] };
}

/** Increment task_seq in the same transaction; returns the new human task id. */
export interface TaskSeqAllocator {
	incrementTaskSeq(groupPk: string): Promise<{ key: string; seq: number }>;
}

export async function allocateTaskId(tx: TaskSeqAllocator, groupPk: string): Promise<string> {
	const { key, seq } = await tx.incrementTaskSeq(groupPk);
	return formatTaskId(key, seq);
}
