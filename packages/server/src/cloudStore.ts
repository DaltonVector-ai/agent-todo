import type { Store } from "@agent-todo/core";
import { openStore, type PostgresStore } from "@agent-todo/store-postgres";
import type { Pool } from "pg";
import type { ChangeHub } from "./changeHub.js";
import { emitProjectNotify } from "./fanout/notify.js";
import { notifiableStore } from "./notifyStore.js";
import { checkCommentQuota, checkWriteQuota } from "./quotas.js";
import { createRoutedStore } from "./replicas.js";
import { getProjectPk, getRequestMinRev, getTokenPk } from "./requestContext.js";

export type OpenCloudStoreOptions = {
	databaseUrl: string;
	replicaUrl?: string | null;
	projectPk: string;
	pool: Pool;
	changeHub: ChangeHub;
};

export async function openCloudProjectStore(opts: OpenCloudStoreOptions): Promise<Store> {
	const primary = await openStore({ databaseUrl: opts.databaseUrl, projectPk: opts.projectPk });
	let replica: PostgresStore | null = null;
	if (opts.replicaUrl) {
		replica = await openStore({ databaseUrl: opts.replicaUrl, projectPk: opts.projectPk });
	}

	const routed = createRoutedStore({
		primary,
		replica,
		projectPk: opts.projectPk,
		getMinRev: getRequestMinRev,
		replicaMaxRev: async () => {
			if (!replica) return null;
			try {
				return await replica.events.latestRev();
			} catch {
				return null;
			}
		},
	});

	const hubbed = notifiableStore(routed, opts.changeHub, opts.projectPk);
	const withQuota = wrapWriteQuotas(hubbed, opts.pool);
	return wrapPgNotify(withQuota, opts.pool, opts.projectPk);
}

function wrapWriteQuotas(store: Store, pool: Pool): Store {
	const beforeWrite = async () => {
		const tokenPk = getTokenPk();
		if (tokenPk) await checkWriteQuota(pool, tokenPk);
	};
	const beforeComment = async () => {
		const projectPk = getProjectPk();
		if (projectPk) await checkCommentQuota(pool, projectPk);
	};
	return {
		...store,
		groups: {
			...store.groups,
			create: async (input) => {
				await beforeWrite();
				return store.groups.create(input);
			},
			update: async (key, input) => {
				await beforeWrite();
				return store.groups.update(key, input);
			},
		},
		tasks: {
			...store.tasks,
			create: async (input) => {
				await beforeWrite();
				return store.tasks.create(input);
			},
			update: async (id, input) => {
				await beforeWrite();
				return store.tasks.update(id, input);
			},
		},
		comments: {
			...store.comments,
			create: async (input) => {
				await beforeWrite();
				await beforeComment();
				return store.comments.create(input);
			},
			update: async (id, input) => {
				await beforeWrite();
				return store.comments.update(id, input);
			},
		},
		events: {
			...store.events,
			append: async (input) => {
				await beforeWrite();
				return store.events.append(input);
			},
		},
		tx: async (fn) => {
			await beforeWrite();
			return store.tx(fn);
		},
		claimNext: async (filter) => {
			await beforeWrite();
			return store.claimNext(filter);
		},
	};
}

function wrapPgNotify(store: Store, pool: Pool, projectPk: string): Store {
	const notify = async (groupKey?: string) => {
		const rev = await store.events.latestRev().catch(() => undefined);
		await emitProjectNotify(pool, { projectPk, groupKey, rev });
	};

	return {
		...store,
		events: {
			...store.events,
			append: async (input) => {
				const row = await store.events.append(input);
				await notify(input.groupKey);
				return row;
			},
		},
		tx: async (fn) => {
			const result = await store.tx(fn);
			await notify();
			return result;
		},
		claimNext: async (filter) => {
			const row = await store.claimNext(filter);
			if (row) await notify(row.groupKey);
			return row;
		},
		groups: {
			...store.groups,
			create: async (input) => {
				const row = await store.groups.create(input);
				await notify(input.key);
				return row;
			},
			update: async (key, input) => {
				const row = await store.groups.update(key, input);
				await notify(key);
				return row;
			},
		},
		tasks: {
			...store.tasks,
			create: async (input) => {
				const row = await store.tasks.create(input);
				await notify(input.groupKey);
				return row;
			},
			update: async (id, input) => {
				const existing = await store.tasks.getById(id);
				const row = await store.tasks.update(id, input);
				await notify(existing?.groupKey);
				return row;
			},
		},
		comments: {
			...store.comments,
			create: async (input) => {
				const row = await store.comments.create(input);
				const task = await store.tasks.getById(input.taskId);
				await notify(task?.groupKey);
				return row;
			},
		},
	};
}
