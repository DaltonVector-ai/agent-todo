import type { Store } from "../store/Store.js";
import type { EventRow } from "../store/types.js";

export type ChangesSinceOpts = {
	groupKey?: string;
	entities?: string[];
	limit?: number;
};

export type ChangesSinceResult = {
	rev: number;
	events: EventRow[];
};

export async function changesSince(
	store: Store,
	sinceRev: number,
	opts: ChangesSinceOpts = {},
): Promise<ChangesSinceResult> {
	const events = await store.events.listSinceRev(sinceRev, {
		groupKey: opts.groupKey,
		limit: opts.limit ?? 500,
	});
	const filtered = opts.entities?.length
		? events.filter((e) => opts.entities?.includes(e.entity))
		: events;
	const rev = await store.events.latestRev();
	return { rev, events: filtered };
}
