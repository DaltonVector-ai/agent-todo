export interface OrgsTable {
	pk: string;
	slug: string;
	name: string;
	created_at: string;
}

export interface ProjectsTable {
	pk: string;
	org_pk: string;
	slug: string;
	name: string;
	rev: number;
	settings: unknown;
	created_at: string;
}

export interface ApiTokensTable {
	pk: string;
	project_pk: string;
	name: string;
	hash: string;
	toolset_ceiling: string;
	groups: string[] | null;
	expires_at: string | null;
	last_used_at: string | null;
	created_at: string;
}

export interface GroupsTable {
	pk: string;
	project_pk: string;
	key: string;
	name: string;
	summary: string;
	default_model: string | null;
	default_skills: unknown;
	default_mcps: unknown;
	task_seq: number;
	terminal_status: string;
	archived: boolean;
	version: number;
	created_at: string;
	updated_at: string;
}

export interface ContextSectionsTable {
	pk: string;
	project_pk: string;
	group_pk: string;
	slug: string;
	title: string;
	body: string;
	position: number;
	tokens: number;
	always_include: boolean;
	applies_to: unknown;
	version: number;
	updated_at: string;
}

export interface TasksTable {
	pk: string;
	project_pk: string;
	id: string;
	group_pk: string;
	parent_pk: string | null;
	title: string;
	description: string;
	status: string;
	priority: number;
	preferred_model: string | null;
	skills: unknown;
	mcps: unknown;
	tags: unknown;
	acceptance: unknown;
	assignee: string | null;
	claim_owner: string | null;
	claim_expires: string | null;
	desc_tokens: number;
	comment_count: number;
	archived: boolean;
	version: number;
	created_at: string;
	updated_at: string;
}

export interface TaskDepsTable {
	project_pk: string;
	task_pk: string;
	depends_on_pk: string;
}

export interface CommentsTable {
	pk: string;
	project_pk: string;
	id: string;
	task_pk: string;
	seq: number;
	author: string;
	kind: string;
	body: string;
	summary: string;
	tokens: number;
	pinned: boolean;
	reply_to_pk: string | null;
	compacted_into: string | null;
	created_at: string;
}

export interface EventsTable {
	project_pk: string;
	rev: number;
	entity: string;
	entity_id: string;
	group_key: string;
	action: string;
	actor: string;
	diff: unknown;
	at: string;
}

export interface MigrationsTable {
	id: string;
	applied_at: string;
}

export interface PostgresDatabase {
	orgs: OrgsTable;
	projects: ProjectsTable;
	members: MembersTable;
	api_tokens: ApiTokensTable;
	groups: GroupsTable;
	context_sections: ContextSectionsTable;
	tasks: TasksTable;
	task_deps: TaskDepsTable;
	comments: CommentsTable;
	events: EventsTable;
	_migrations: MigrationsTable;
}

export interface MembersTable {
	org_pk: string;
	user_id: string;
	role: string;
}
