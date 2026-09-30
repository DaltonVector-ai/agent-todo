import type { CommentRow, EventRow, GroupRow, SectionRow, TaskRow } from "@agent-todo/core";

export type PushPayload = {
	groups: GroupRow[];
	tasks: TaskRow[];
	comments: CommentRow[];
	sections: SectionRow[];
	events: EventRow[];
	taskDeps: Array<{ taskId: string; dependsOnId: string }>;
};

export async function buildPushPayload(store: {
	groups: { list(opts?: { includeArchived?: boolean }): Promise<GroupRow[]> };
	tasks: {
		listByGroup(groupKey: string, opts?: { includeArchived?: boolean }): Promise<TaskRow[]>;
		listDependsOn(taskId: string): Promise<string[]>;
	};
	comments: { listByTask(taskId: string): Promise<CommentRow[]> };
	sections: { listByGroup(groupKey: string): Promise<SectionRow[]> };
	events: {
		latestRev(): Promise<number>;
		listSinceRev(sinceRev: number, opts?: { limit?: number }): Promise<EventRow[]>;
	};
}): Promise<PushPayload> {
	const groups = await store.groups.list({ includeArchived: true });
	const tasks: TaskRow[] = [];
	const comments: CommentRow[] = [];
	const sections: SectionRow[] = [];
	const taskDeps: PushPayload["taskDeps"] = [];

	for (const g of groups) {
		const groupTasks = await store.tasks.listByGroup(g.key, { includeArchived: true });
		tasks.push(...groupTasks);
		sections.push(...(await store.sections.listByGroup(g.key)));
		for (const t of groupTasks) {
			comments.push(...(await store.comments.listByTask(t.id)));
			for (const depId of await store.tasks.listDependsOn(t.id)) {
				taskDeps.push({ taskId: t.id, dependsOnId: depId });
			}
		}
	}

	const rev = await store.events.latestRev();
	const events = rev > 0 ? await store.events.listSinceRev(0, { limit: rev + 1 }) : [];

	return { groups, tasks, comments, sections, events, taskDeps };
}
