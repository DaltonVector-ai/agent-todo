export type AcceptanceItem = { text: string; done: boolean };

/** Marks acceptance strings that were done:true in legacy object form. */
const DONE_PREFIX = "\u001e";

export function normalizeAcceptanceInput(raw: unknown): string[] | undefined {
	if (raw === undefined) return undefined;
	if (!Array.isArray(raw)) return undefined;
	const out: string[] = [];
	for (const item of raw) {
		if (typeof item === "string") {
			const text = item.trim();
			if (text) out.push(text);
			continue;
		}
		if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
			const { text: rawText, done } = item as { text: string; done?: boolean };
			const text = rawText.trim();
			if (!text) continue;
			out.push(done ? `${DONE_PREFIX}${text}` : text);
		}
	}
	return out;
}

export function acceptanceStringsToItems(
	items: string[] | undefined,
): AcceptanceItem[] | undefined {
	if (items === undefined) return undefined;
	return items.map((item) => {
		if (item.startsWith(DONE_PREFIX)) {
			return { text: item.slice(DONE_PREFIX.length), done: true };
		}
		return { text: item, done: false };
	});
}
