import type { TaskSeqAllocator } from "../domain/ids.js";
import type {
	AppendEventInput,
	ClaimFilter,
	CommentRow,
	CreateCommentInput,
	CreateGroupInput,
	CreateSectionInput,
	CreateTaskInput,
	EventRow,
	GroupRow,
	ListEventsOpts,
	SearchHit,
	SearchQuery,
	SectionRow,
	TaskRow,
	UpdateCommentInput,
	UpdateGroupInput,
	UpdateSectionInput,
	UpdateTaskInput,
} from "./types.js";

export interface GroupRepo {
	create(input: CreateGroupInput): Promise<GroupRow>;
	getByKey(key: string): Promise<GroupRow | null>;
	getByPk(pk: string): Promise<GroupRow | null>;
	update(key: string, input: UpdateGroupInput): Promise<GroupRow>;
	list(opts?: { includeArchived?: boolean }): Promise<GroupRow[]>;
}

export interface TaskRepo {
	create(input: CreateTaskInput): Promise<TaskRow>;
	getById(id: string): Promise<TaskRow | null>;
	getByPk(pk: string): Promise<TaskRow | null>;
	update(id: string, input: UpdateTaskInput): Promise<TaskRow>;
	listByGroup(groupKey: string, opts?: { includeArchived?: boolean }): Promise<TaskRow[]>;
	setDependencies(taskPk: string, dependsOnPks: string[]): Promise<void>;
	listDependsOn(taskId: string): Promise<string[]>;
	moveToGroup(taskId: string, groupKey: string): Promise<TaskRow>;
}

export interface CommentRepo {
	create(input: CreateCommentInput): Promise<CommentRow>;
	getById(id: string): Promise<CommentRow | null>;
	listByTask(taskId: string): Promise<CommentRow[]>;
	update(id: string, input: UpdateCommentInput): Promise<CommentRow>;
}

export interface SectionRepo {
	create(input: CreateSectionInput): Promise<SectionRow>;
	getById(sectionId: string): Promise<SectionRow | null>;
	update(sectionId: string, input: UpdateSectionInput): Promise<SectionRow>;
	listByGroup(groupKey: string): Promise<SectionRow[]>;
}

export interface EventRepo {
	append(input: AppendEventInput): Promise<EventRow>;
	listSince(groupKey: string, sinceRev: number, limit?: number): Promise<EventRow[]>;
	listSinceRev(sinceRev: number, opts?: ListEventsOpts): Promise<EventRow[]>;
	latestRev(): Promise<number>;
}

export interface Store extends TaskSeqAllocator {
	tx<T>(fn: (s: Store) => Promise<T> | T): Promise<T>;
	groups: GroupRepo;
	tasks: TaskRepo;
	comments: CommentRepo;
	sections: SectionRepo;
	events: EventRepo;
	claimNext(filter: ClaimFilter): Promise<TaskRow | null>;
	search(q: SearchQuery): Promise<SearchHit[]>;
	close(): Promise<void>;
}
