import type { Store } from "@agent-todo/core";
import type { ChangeHub } from "./changeHub.js";

/** Wraps a store so successful writes notify the board SSE hub. */
export function notifiableStore(store: Store, hub: ChangeHub, projectPk?: string): Store {
	const bump = (groupKey?: string) => hub.bump(groupKey, projectPk);

	return {
		groups: store.groups,
		tasks: store.tasks,
		comments: store.comments,
		sections: store.sections,
		events: {
			append: async (input) => {
				const row = await store.events.append(input);
				bump(input.groupKey);
				return row;
			},
			listSince: store.events.listSince.bind(store.events),
			listSinceRev: store.events.listSinceRev.bind(store.events),
			latestRev: store.events.latestRev.bind(store.events),
		},
		tx: async (fn) => {
			const result = await store.tx(fn);
			bump();
			return result;
		},
		claimNext: async (filter) => {
			const row = await store.claimNext(filter);
			if (row) bump(row.groupKey);
			return row;
		},
		peekNextOpen: store.peekNextOpen.bind(store),
		search: store.search.bind(store),
		close: store.close.bind(store),
		incrementTaskSeq: store.incrementTaskSeq.bind(store),
	};
}
