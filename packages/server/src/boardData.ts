import { type Store, TASK_STATUSES, type TaskRow } from "@agent-todo/core";

export type BoardAuthContext = {
	groupAllowList?: string[];
};

export function isGroupAllowed(ctx: BoardAuthContext, groupKey: string): boolean {
	const list = ctx.groupAllowList;
	if (!list || list.length === 0) return true;
	return list.includes(groupKey);
}

export type BoardGroupSummary = {
	key: string;
	name: string;
	summary: string;
	openTasks: number;
	totalTasks: number;
};

export async function listBoardGroups(store: Store): Promise<{
	rev: number;
	groups: BoardGroupSummary[];
}> {
	const rev = await store.events.latestRev();
	const groups = await store.groups.list();
	const summaries: BoardGroupSummary[] = [];

	for (const group of groups) {
		if (group.archived) continue;
		const tasks = await store.tasks.listByGroup(group.key);
		const active = tasks.filter((t) => !t.archived);
		const openTasks = active.filter((t) => t.status === "open" || t.status === "reopen").length;
		summaries.push({
			key: group.key,
			name: group.name,
			summary: group.summary,
			openTasks,
			totalTasks: active.length,
		});
	}

	return { rev, groups: summaries };
}

export async function buildBoardPayload(
	store: Store,
	ctx: BoardAuthContext,
): Promise<{
	rev: number;
	groups: { key: string; name: string }[];
	columns: Record<string, unknown[]>;
}> {
	const columns: Record<string, unknown[]> = {};
	for (const status of TASK_STATUSES) columns[status] = [];

	const groups = await store.groups.list();
	const visibleGroups = groups.filter((g) => !g.archived && isGroupAllowed(ctx, g.key));

	for (const group of visibleGroups) {
		const tasks = await store.tasks.listByGroup(group.key);
		for (const task of tasks) {
			if (task.archived) continue;
			const col = columns[task.status];
			if (col) {
				col.push({
					id: task.id,
					groupKey: task.groupKey,
					title: task.title,
					status: task.status,
					priority: task.priority,
					claimOwner: task.claimOwner,
				});
			}
		}
	}

	const rev = await store.events.latestRev();
	return {
		rev,
		groups: visibleGroups.map((g) => ({ key: g.key, name: g.name })),
		columns,
	};
}

export type TaskDrawerPayload = {
	id: string;
	groupKey: string;
	title: string;
	description: string;
	status: string;
	priority: number;
	tags: string[];
	assignee: string | null;
	claimOwner: string | null;
	claimExpires: string | null;
	preferredModel: string | null;
	skills: string[];
	mcps: string[];
	createdAt: string;
	updatedAt: string;
	commentCount: number;
	comments: Array<{
		id: string;
		kind: string;
		author: string;
		summary: string;
		createdAt: string;
	}>;
};

export function taskDrawerPayload(
	task: TaskRow,
	comments: Array<{
		id: string;
		kind: string;
		author: string;
		summary: string;
		createdAt: string;
		compactedInto: string | null;
	}>,
): TaskDrawerPayload {
	const live = comments.filter((c) => !c.compactedInto);
	const summaries = live.slice(-20).map((cm) => ({
		id: cm.id,
		kind: cm.kind,
		author: cm.author,
		summary: cm.summary,
		createdAt: cm.createdAt,
	}));

	return {
		id: task.id,
		groupKey: task.groupKey,
		title: task.title,
		description: task.description,
		status: task.status,
		priority: task.priority,
		tags: task.tags,
		assignee: task.assignee,
		claimOwner: task.claimOwner,
		claimExpires: task.claimExpires,
		preferredModel: task.preferredModel,
		skills: task.skills,
		mcps: task.mcps,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		commentCount: task.commentCount,
		comments: summaries,
	};
}
