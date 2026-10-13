export type GroupSummary = {
	key: string;
	name: string;
	summary: string;
	openTasks: number;
	totalTasks: number;
};

export type BoardTask = {
	id: string;
	groupKey: string;
	title: string;
	status: string;
	priority: number;
	claimOwner: string | null;
};

export type GroupsPayload = { rev: number; groups: GroupSummary[] };

export type BoardPayload = {
	rev: number;
	groups: { key: string; name: string }[];
	columns: Record<string, BoardTask[]>;
};

export type TaskDetail = {
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

export type ContextPayload = {
	group: { key: string; name: string };
	toc: { slug: string; title: string; position: number; tokens: number }[];
	sections: { slug: string; title: string; body: string }[];
};

async function boardFetch(path: string): Promise<Response> {
	return fetch(path);
}

export async function fetchGroups(): Promise<GroupsPayload> {
	const res = await boardFetch("/api/groups");
	if (!res.ok) throw new Error(`groups ${res.status}`);
	return res.json() as Promise<GroupsPayload>;
}

export async function fetchBoard(): Promise<BoardPayload> {
	const res = await boardFetch("/api/board");
	if (!res.ok) throw new Error(`board ${res.status}`);
	return res.json() as Promise<BoardPayload>;
}

export async function fetchTask(groupKey: string, taskId: string): Promise<TaskDetail> {
	const res = await boardFetch(
		`/api/groups/${encodeURIComponent(groupKey)}/tasks/${encodeURIComponent(taskId)}`,
	);
	if (res.status === 404) throw new Error("not_found");
	if (!res.ok) throw new Error(`task ${res.status}`);
	return res.json() as Promise<TaskDetail>;
}

export async function fetchContext(groupKey: string): Promise<ContextPayload> {
	const res = await boardFetch(`/api/groups/${encodeURIComponent(groupKey)}/context`);
	if (res.status === 404) throw new Error("not_found");
	if (!res.ok) throw new Error(`context ${res.status}`);
	return res.json() as Promise<ContextPayload>;
}
