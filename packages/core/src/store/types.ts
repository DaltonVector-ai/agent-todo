import type { TaskStatus, TerminalStatus } from "../domain/status.js";

export type JsonArray = string[];

export type AcceptanceItem = { text: string; done: boolean };

export type GroupRow = {
	pk: string;
	key: string;
	name: string;
	summary: string;
	defaultModel: string | null;
	defaultSkills: JsonArray;
	defaultMcps: JsonArray;
	taskSeq: number;
	terminalStatus: TerminalStatus;
	archived: boolean;
	version: number;
	createdAt: string;
	updatedAt: string;
};

export type CreateGroupInput = {
	key: string;
	name: string;
	summary?: string;
	defaultModel?: string | null;
	defaultSkills?: JsonArray;
	defaultMcps?: JsonArray;
	terminalStatus?: TerminalStatus;
};

export type UpdateGroupInput = Partial<
	Omit<CreateGroupInput, "key"> & { archived?: boolean; version?: number }
>;

export type TaskRow = {
	pk: string;
	id: string;
	groupPk: string;
	groupKey: string;
	parentPk: string | null;
	title: string;
	description: string;
	status: TaskStatus;
	priority: number;
	preferredModel: string | null;
	skills: JsonArray;
	mcps: JsonArray;
	tags: JsonArray;
	acceptance: AcceptanceItem[];
	assignee: string | null;
	claimOwner: string | null;
	claimExpires: string | null;
	descTokens: number;
	commentCount: number;
	archived: boolean;
	version: number;
	createdAt: string;
	updatedAt: string;
};

export type CreateTaskInput = {
	groupKey: string;
	title: string;
	description?: string;
	status?: TaskStatus;
	priority?: number;
	preferredModel?: string | null;
	skills?: JsonArray;
	mcps?: JsonArray;
	tags?: JsonArray;
	acceptance?: AcceptanceItem[];
	assignee?: string | null;
	parentPk?: string | null;
	dependsOnPks?: string[];
};

export type UpdateTaskInput = Partial<
	Omit<CreateTaskInput, "groupKey" | "dependsOnPks"> & {
		status?: TaskStatus;
		archived?: boolean;
		version?: number;
		claimOwner?: string | null;
		claimExpires?: string | null;
		dependsOnPks?: string[];
	}
>;

export type CommentRow = {
	pk: string;
	id: string;
	taskPk: string;
	taskId: string;
	seq: number;
	author: string;
	kind: string;
	body: string;
	summary: string;
	tokens: number;
	pinned: boolean;
	replyToPk: string | null;
	compactedInto: string | null;
	createdAt: string;
};

export type CreateCommentInput = {
	taskId: string;
	author: string;
	kind: string;
	body: string;
	summary?: string;
	pinned?: boolean;
	replyToPk?: string | null;
};

export type SectionRow = {
	pk: string;
	groupPk: string;
	groupKey: string;
	slug: string;
	title: string;
	body: string;
	position: number;
	tokens: number;
	alwaysInclude: boolean;
	appliesTo: JsonArray;
	version: number;
	updatedAt: string;
};

export type CreateSectionInput = {
	groupKey: string;
	slug: string;
	title: string;
	body?: string;
	position: number;
	alwaysInclude?: boolean;
	appliesTo?: JsonArray;
};

export type UpdateSectionInput = Partial<
	Omit<CreateSectionInput, "groupKey" | "slug"> & { version?: number }
>;

export type EventDiff = Record<string, [unknown, unknown]>;

export type EventRow = {
	rev: number;
	entity: string;
	entityId: string;
	groupKey: string;
	action: string;
	actor: string;
	diff: EventDiff;
	at: string;
};

export type AppendEventInput = {
	entity: string;
	entityId: string;
	groupKey: string;
	action: string;
	actor: string;
	diff: EventDiff;
};

export type ClaimFilter = {
	groupKey?: string;
	owner: string;
	leaseSeconds?: number;
};

export type SearchEntity = "task" | "comment";

export type SearchQuery = {
	q: string;
	entity?: SearchEntity;
	groupKey?: string;
	limit?: number;
};

export type SearchHit = {
	entity: SearchEntity;
	id: string;
	groupKey: string;
	snippet: string;
};
