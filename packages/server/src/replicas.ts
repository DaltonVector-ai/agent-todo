import type { Store } from "@agent-todo/core";
import type { PostgresStore } from "@agent-todo/store-postgres";

export type ReplicaRouterOptions = {
	primaryUrl: string;
	replicaUrls?: string[];
};

/** Parses comma-separated replica URLs from env. */
export function parseReplicaUrls(raw: string | undefined): string[] {
	if (!raw?.trim()) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Returns true when the client requires a revision newer than the replica can serve.
 */
export function routeReadToPrimary(
	minRev: number | undefined,
	replicaMaxRev: number | null,
): boolean {
	if (minRev === undefined || minRev <= 0) return false;
	if (replicaMaxRev === null) return true;
	return minRev > replicaMaxRev;
}

export type RoutedStoreOptions = {
	primary: PostgresStore;
	replica: PostgresStore | null;
	projectPk: string;
	getMinRev: () => number | undefined;
	replicaMaxRev: () => Promise<number | null>;
};

/** Routes list/search/context reads to a replica when min_rev allows read-your-writes on primary otherwise. */
export function createRoutedStore(opts: RoutedStoreOptions): Store {
	const { primary, replica, getMinRev } = opts;

	async function readStore(explicitMinRev?: number): Promise<Store> {
		if (!replica) return primary;
		const minRev = explicitMinRev ?? getMinRev();
		const lag = await opts.replicaMaxRev();
		if (routeReadToPrimary(minRev, lag)) return primary;
		return replica;
	}

	const write = primary;

	return {
		groups: {
			create: (input) => write.groups.create(input),
			getByKey: (key) => readStore().then((s) => s.groups.getByKey(key)),
			getByPk: (pk) => readStore().then((s) => s.groups.getByPk(pk)),
			update: (key, input) => write.groups.update(key, input),
			list: (opts) => readStore().then((s) => s.groups.list(opts)),
		},
		tasks: {
			create: (input) => write.tasks.create(input),
			getById: (id) => readStore().then((s) => s.tasks.getById(id)),
			getByPk: (pk) => readStore().then((s) => s.tasks.getByPk(pk)),
			update: (id, input) => write.tasks.update(id, input),
			listByGroup: (groupKey, opts) => readStore().then((s) => s.tasks.listByGroup(groupKey, opts)),
			setDependencies: (taskPk, deps) => write.tasks.setDependencies(taskPk, deps),
			listDependsOn: (taskId) => readStore().then((s) => s.tasks.listDependsOn(taskId)),
			moveToGroup: (taskId, groupKey) => write.tasks.moveToGroup(taskId, groupKey),
		},
		comments: {
			create: (input) => write.comments.create(input),
			getById: (id) => readStore().then((s) => s.comments.getById(id)),
			listByTask: (taskId) => readStore().then((s) => s.comments.listByTask(taskId)),
			update: (id, input) => write.comments.update(id, input),
		},
		sections: {
			create: (input) => write.sections.create(input),
			getById: (sectionId) => readStore().then((s) => s.sections.getById(sectionId)),
			update: (sectionId, input) => write.sections.update(sectionId, input),
			listByGroup: (groupKey) => readStore().then((s) => s.sections.listByGroup(groupKey)),
		},
		events: {
			append: (input) => write.events.append(input),
			listSince: (groupKey, sinceRev, limit) =>
				readStore().then((s) => s.events.listSince(groupKey, sinceRev, limit)),
			listSinceRev: (sinceRev, opts) =>
				readStore().then((s) => s.events.listSinceRev(sinceRev, opts)),
			latestRev: () => readStore().then((s) => s.events.latestRev()),
		},
		tx: (fn) => write.tx(fn),
		claimNext: (filter) => write.claimNext(filter),
		peekNextOpen: (filter) => readStore().then((s) => s.peekNextOpen(filter)),
		search: (query) => readStore().then((s) => s.search(query)),
		close: async () => {
			await primary.close();
			if (replica) await replica.close();
		},
		incrementTaskSeq: (groupPk) => write.incrementTaskSeq(groupPk),
	};
}
