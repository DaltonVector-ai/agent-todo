import type { AcceptanceItem } from "@agent-todo/core";

export function parseJsonArray(raw: string): string[] {
	try {
		const v = JSON.parse(raw) as unknown;
		return Array.isArray(v) ? v.map(String) : [];
	} catch {
		return [];
	}
}

export function stringifyJsonArray(values: string[]): string {
	return JSON.stringify(values ?? []);
}

export function parseAcceptance(raw: string): AcceptanceItem[] {
	try {
		const v = JSON.parse(raw) as unknown;
		if (!Array.isArray(v)) return [];
		return v.map((item) => {
			if (item && typeof item === "object" && "text" in item) {
				const o = item as { text: string; done?: boolean };
				return { text: String(o.text), done: Boolean(o.done) };
			}
			return { text: String(item), done: false };
		});
	} catch {
		return [];
	}
}

export function stringifyAcceptance(items: AcceptanceItem[]): string {
	return JSON.stringify(items ?? []);
}

export function jsonArrayFromDb(raw: unknown): string[] {
	if (typeof raw === "string") return parseJsonArray(raw);
	if (Array.isArray(raw)) return raw.map(String);
	return [];
}

export function jsonAcceptanceFromDb(raw: unknown): AcceptanceItem[] {
	if (typeof raw === "string") return parseAcceptance(raw);
	if (Array.isArray(raw)) {
		return raw.map((item) => {
			if (item && typeof item === "object" && "text" in item) {
				const o = item as { text: string; done?: boolean };
				return { text: String(o.text), done: Boolean(o.done) };
			}
			return { text: String(item), done: false };
		});
	}
	return [];
}

export function jsonValue(values: string[] | AcceptanceItem[]): unknown {
	return values;
}
