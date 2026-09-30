export interface GroupsTable {
	pk: string;
	key: string;
	name: string;
	summary: string;
	default_model: string | null;
	default_skills: string;
	default_mcps: string;
	task_seq: number;
	terminal_status: string;
	archived: number;
	version: number;
	created_at: string;
	updated_at: string;
}

export interface ContextSectionsTable {
	pk: string;
	group_pk: string;
	slug: string;
	title: string;
	body: string;
	position: number;
	tokens: number;
	always_include: number;
	applies_to: string;
	version: number;
	updated_at: string;
}

export interface TasksTable {
	pk: string;
	id: string;
	group_pk: string;
	parent_pk: string | null;
	title: string;
	description: string;
	status: string;
	priority: number;
	preferred_model: string | null;
	skills: string;
	mcps: string;
	tags: string;
	acceptance: string;
	assignee: string | null;
	claim_owner: string | null;
	claim_expires: string | null;
	desc_tokens: number;
	comment_count: number;
	archived: number;
	version: number;
	created_at: string;
	updated_at: string;
}

export interface TaskDepsTable {
	task_pk: string;
	depends_on_pk: string;
}

export interface CommentsTable {
	pk: string;
	id: string;
	task_pk: string;
	seq: number;
	author: string;
	kind: string;
	body: string;
	summary: string;
	tokens: number;
	pinned: number;
	reply_to_pk: string | null;
	compacted_into: string | null;
	created_at: string;
}

export interface EventsTable {
	rev?: number;
	entity: string;
	entity_id: string;
	group_key: string;
	action: string;
	actor: string;
	diff: string;
	at: string;
}

export interface MigrationsTable {
	id: string;
	applied_at: string;
}

export interface SqliteDatabase {
	groups: GroupsTable;
	context_sections: ContextSectionsTable;
	tasks: TasksTable;
	task_deps: TaskDepsTable;
	comments: CommentsTable;
	events: EventsTable;
	_migrations: MigrationsTable;
}
