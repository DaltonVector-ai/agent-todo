import type { ClaimFilter, Store, TaskRow } from "@agent-todo/core";

/** Store view limited to a token's group allow-list. Used for MCP, not the public board. */
export function scopeStore(store: Store, allowList: string[]): Store {
	const allowed = new Set(allowList);

	const scanAllowedGroups = async (
		filter: ClaimFilter,
		read: (scoped: ClaimFilter) => Promise<TaskRow | null>,
	): Promise<TaskRow | null> => {
		if (filter.groupKey) {
			if (!allowed.has(filter.groupKey)) return null;
			return read(filter);
		}
		for (const groupKey of allowList) {
			const row = await read({ ...filter, groupKey });
			if (row && allowed.has(row.groupKey)) return row;
		}
		return null;
	};

	const wrap = (inner: Store): Store => {
		return {
			incrementTaskSeq: (groupPk) => inner.incrementTaskSeq(groupPk),
			close: () => inner.close(),
			tx: (fn) => inner.tx((s) => fn(wrap(s))),
			groups: {
				create: async (input) => {
					if (!allowed.has(input.key)) throw new Error(`group not allowed: ${input.key}`);
					return inner.groups.create(input);
				},
				getByKey: async (key) => (allowed.has(key) ? inner.groups.getByKey(key) : null),
				getByPk: async (pk) => {
					const row = await inner.groups.getByPk(pk);
					if (!row || !allowed.has(row.key)) return null;
					return row;
				},
				update: async (key, input) => {
					if (!allowed.has(key)) throw new Error(`group not allowed: ${key}`);
					return inner.groups.update(key, input);
				},
				list: async (opts) => {
					const rows = await inner.groups.list(opts);
					return rows.filter((g) => allowed.has(g.key));
				},
			},
			tasks: {
				create: async (input) => {
					if (!allowed.has(input.groupKey)) throw new Error(`group not allowed: ${input.groupKey}`);
					return inner.tasks.create(input);
				},
				getById: async (id) => {
					const row = await inner.tasks.getById(id);
					if (!row || !allowed.has(row.groupKey)) return null;
					return row;
				},
				getByPk: async (pk) => {
					const row = await inner.tasks.getByPk(pk);
					if (!row || !allowed.has(row.groupKey)) return null;
					return row;
				},
				update: async (id, input) => {
					const existing = await inner.tasks.getById(id);
					if (!existing || !allowed.has(existing.groupKey)) {
						throw new Error(`group not allowed`);
					}
					return inner.tasks.update(id, input);
				},
				listByGroup: async (groupKey, opts) =>
					allowed.has(groupKey) ? inner.tasks.listByGroup(groupKey, opts) : [],
				setDependencies: (taskPk, dependsOnPks) =>
					inner.tasks.setDependencies(taskPk, dependsOnPks),
				listDependsOn: (taskId) => inner.tasks.listDependsOn(taskId),
				moveToGroup: async (taskId, groupKey) => {
					if (!allowed.has(groupKey)) throw new Error(`group not allowed: ${groupKey}`);
					const existing = await inner.tasks.getById(taskId);
					if (!existing || !allowed.has(existing.groupKey)) {
						throw new Error(`group not allowed`);
					}
					return inner.tasks.moveToGroup(taskId, groupKey);
				},
			},
			comments: {
				create: async (input) => {
					const task = await inner.tasks.getById(input.taskId);
					if (!task || !allowed.has(task.groupKey)) throw new Error(`group not allowed`);
					return inner.comments.create(input);
				},
				getById: (id) => inner.comments.getById(id),
				listByTask: async (taskId) => {
					const task = await inner.tasks.getById(taskId);
					if (!task || !allowed.has(task.groupKey)) return [];
					return inner.comments.listByTask(taskId);
				},
				update: (id, input) => inner.comments.update(id, input),
			},
			sections: {
				create: async (input) => {
					if (!allowed.has(input.groupKey)) throw new Error(`group not allowed: ${input.groupKey}`);
					return inner.sections.create(input);
				},
				getById: (sectionId) => inner.sections.getById(sectionId),
				update: (sectionId, input) => inner.sections.update(sectionId, input),
				listByGroup: async (groupKey) =>
					allowed.has(groupKey) ? inner.sections.listByGroup(groupKey) : [],
			},
			events: {
				append: async (input) => {
					if (!allowed.has(input.groupKey)) throw new Error(`group not allowed: ${input.groupKey}`);
					return inner.events.append(input);
				},
				listSince: async (groupKey, sinceRev, limit) =>
					allowed.has(groupKey) ? inner.events.listSince(groupKey, sinceRev, limit) : [],
				listSinceRev: async (sinceRev, opts) => {
					const rows = await inner.events.listSinceRev(sinceRev, opts);
					return rows.filter((row) => allowed.has(row.groupKey));
				},
				latestRev: () => inner.events.latestRev(),
			},
			claimNext: (filter) => scanAllowedGroups(filter, (scoped) => inner.claimNext(scoped)),
			peekNextOpen: (filter) => scanAllowedGroups(filter, (scoped) => inner.peekNextOpen(scoped)),
			search: async (q) => {
				const hits = await inner.search(q);
				if (q.groupKey && !allowed.has(q.groupKey)) return [];
				return hits.filter((hit) => allowed.has(hit.groupKey));
			},
		};
	};

	return wrap(store);
}
