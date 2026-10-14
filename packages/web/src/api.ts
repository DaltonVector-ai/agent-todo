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

export type ProjectSummary = {
	code: string;
	name: string;
	path: string;
};

function projectQuery(projectCode?: string | null): string {
	if (!projectCode) return "";
	return `?project=${encodeURIComponent(projectCode)}`;
}

/** `null` means this server has no project list (the per-project daemon). */
export async function fetchProjects(): Promise<ProjectSummary[] | null> {
	const res = await fetch("/api/projects");
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`projects ${res.status}`);
	const body = (await res.json()) as { projects: ProjectSummary[] };
	return body.projects;
}

export async function fetchGroups(projectCode?: string | null): Promise<GroupsPayload> {
	const res = await fetch(`/api/groups${projectQuery(projectCode)}`);
	if (!res.ok) throw new Error(`groups ${res.status}`);
	return res.json() as Promise<GroupsPayload>;
}

export async function fetchBoard(projectCode?: string | null): Promise<BoardPayload> {
	const res = await fetch(`/api/board${projectQuery(projectCode)}`);
	if (!res.ok) throw new Error(`board ${res.status}`);
	return res.json() as Promise<BoardPayload>;
}

export async function fetchTask(
	groupKey: string,
	taskId: string,
	projectCode?: string | null,
): Promise<TaskDetail> {
	const res = await fetch(
		`/api/groups/${encodeURIComponent(groupKey)}/tasks/${encodeURIComponent(taskId)}${projectQuery(projectCode)}`,
	);
	if (res.status === 404) throw new Error("not_found");
	if (!res.ok) throw new Error(`task ${res.status}`);
	return res.json() as Promise<TaskDetail>;
}

export async function fetchContext(
	groupKey: string,
	projectCode?: string | null,
): Promise<ContextPayload> {
	const res = await fetch(
		`/api/groups/${encodeURIComponent(groupKey)}/context${projectQuery(projectCode)}`,
	);
	if (res.status === 404) throw new Error("not_found");
	if (!res.ok) throw new Error(`context ${res.status}`);
	return res.json() as Promise<ContextPayload>;
}
