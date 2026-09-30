const TRUNCATION_MARKER_RE = /…\[\+\d+ tok, use view=full\]$/;

/** Fast heuristic (~4 characters per token). Not a model tokenizer. */
export function estimate(text: string): number {
	if (!text) return 0;
	return Math.max(1, Math.ceil(text.length / 4));
}

export type TruncateResult = {
	text: string;
	truncated: boolean;
	omittedTokens: number;
};

/**
 * Truncate to fit a token budget, preferring paragraph then line boundaries.
 * Appends `…[+N tok, use view=full]` when content is cut.
 */
export function truncate(text: string, budget: number): TruncateResult {
	if (budget <= 0) {
		const omitted = estimate(text);
		return {
			text: `…[+${omitted} tok, use view=full]`,
			truncated: true,
			omittedTokens: omitted,
		};
	}

	const fullTokens = estimate(text);
	if (fullTokens <= budget) {
		return { text, truncated: false, omittedTokens: 0 };
	}

	const maxChars = budget * 4;
	let slice = text.slice(0, maxChars);

	const para = slice.lastIndexOf("\n\n");
	if (para > slice.length * 0.4) {
		slice = slice.slice(0, para);
	} else {
		const line = slice.lastIndexOf("\n");
		if (line > slice.length * 0.4) {
			slice = slice.slice(0, line);
		}
	}

	slice = slice.trimEnd();
	const kept = slice.length > 0 ? slice : text.slice(0, Math.min(16, text.length));
	const omittedTokens = Math.max(0, fullTokens - estimate(kept));
	const marker = `…[+${omittedTokens} tok, use view=full]`;
	const markerTokens = estimate(marker);
	const room = Math.max(0, budget - markerTokens);
	const roomChars = room * 4;
	const body =
		estimate(kept) > room && roomChars < kept.length ? kept.slice(0, roomChars).trimEnd() : kept;

	return {
		text: `${body}${marker}`,
		truncated: true,
		omittedTokens,
	};
}

export function stripTruncationMarker(text: string): string {
	return text.replace(TRUNCATION_MARKER_RE, "");
}
