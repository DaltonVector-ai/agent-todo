import type { Store } from "../store/Store.js";
import type { AppendEventInput, EventDiff } from "../store/types.js";

export function fieldDiff<T extends Record<string, unknown>>(
	before: T,
	after: T,
	keys: (keyof T)[],
): EventDiff {
	const diff: EventDiff = {};
	for (const key of keys) {
		const a = before[key];
		const b = after[key];
		if (JSON.stringify(a) !== JSON.stringify(b)) {
			diff[String(key)] = [a, b];
		}
	}
	return diff;
}

export async function appendEvent(store: Store, input: AppendEventInput): Promise<void> {
	await store.events.append(input);
}
