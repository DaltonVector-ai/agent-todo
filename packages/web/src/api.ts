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

export type DashboardSession = {
	username: string;
	role: "superuser" | "member";
};

const fetchOpts: RequestInit = { credentials: "include" };

function projectQuery(projectCode?: string | null): string {
	if (!projectCode) return "";
	return `?project=${encodeURIComponent(projectCode)}`;
}

/** `null` means this server has no project list (the per-project daemon). */
/** `null` when the server has no dashboard sessions (legacy token daemon). */
export async function fetchDashboardSession(): Promise<DashboardSession | null | "signed-out"> {
	const res = await fetch("/api/auth/session", fetchOpts);
	if (res.status === 404) return null;
	if (res.status === 401) return "signed-out";
	if (!res.ok) throw new Error(`session ${res.status}`);
	return res.json() as Promise<DashboardSession>;
}

export async function dashboardSignIn(
	username: string,
	password: string,
): Promise<DashboardSession> {
	const res = await fetch("/api/auth/dashboard/sign-in", {
		...fetchOpts,
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ username, password }),
	});
	if (res.status === 401) throw new Error("invalid_credentials");
	if (!res.ok) throw new Error(`sign-in ${res.status}`);
	return res.json() as Promise<DashboardSession>;
}

export async function dashboardSignOut(): Promise<void> {
	const res = await fetch("/api/auth/dashboard/sign-out", { ...fetchOpts, method: "POST" });
	if (!res.ok && res.status !== 204) throw new Error(`sign-out ${res.status}`);
}

export async function changeOwnPassword(
	currentPassword: string,
	newPassword: string,
): Promise<void> {
	const res = await fetch("/api/auth/password", {
		...fetchOpts,
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ currentPassword, newPassword }),
	});
	if (res.status === 401) throw new Error("invalid_password");
	if (!res.ok && res.status !== 204) throw new Error(`password ${res.status}`);
}

export async function fetchMcpToken(): Promise<string> {
	const res = await fetch("/api/auth/mcp-token", fetchOpts);
	if (!res.ok) throw new Error(`mcp-token ${res.status}`);
	const body = (await res.json()) as { token: string };
	return body.token;
}

export async function fetchProjects(): Promise<ProjectSummary[] | null> {
	const res = await fetch("/api/projects", fetchOpts);
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`projects ${res.status}`);
	const body = (await res.json()) as { projects: ProjectSummary[] };
	return body.projects;
}

export async function fetchGroups(projectCode?: string | null): Promise<GroupsPayload> {
	const res = await fetch(`/api/groups${projectQuery(projectCode)}`, fetchOpts);
	if (!res.ok) throw new Error(`groups ${res.status}`);
	return res.json() as Promise<GroupsPayload>;
}

export async function fetchBoard(projectCode?: string | null): Promise<BoardPayload> {
	const res = await fetch(`/api/board${projectQuery(projectCode)}`, fetchOpts);
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
		fetchOpts,
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
		fetchOpts,
	);
	if (res.status === 404) throw new Error("not_found");
	if (!res.ok) throw new Error(`context ${res.status}`);
	return res.json() as Promise<ContextPayload>;
}
