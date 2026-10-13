import type {
	CommentRow,
	EventDiff,
	EventRow,
	GroupRow,
	SectionRow,
	TaskRow,
	TerminalStatus,
} from "@agent-todo/core";
import type {
	CommentsTable,
	ContextSectionsTable,
	EventsTable,
	GroupsTable,
	TasksTable,
} from "./db-types.js";
import { jsonAcceptanceFromDb, jsonArrayFromDb } from "./json.js";

export function mapGroup(row: GroupsTable): GroupRow {
	return {
		pk: row.pk,
		key: row.key,
		name: row.name,
		summary: row.summary,
		defaultModel: row.default_model,
		defaultSkills: jsonArrayFromDb(row.default_skills),
		defaultMcps: jsonArrayFromDb(row.default_mcps),
		taskSeq: row.task_seq,
		terminalStatus: row.terminal_status as TerminalStatus,
		archived: Boolean(row.archived),
		version: row.version,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function mapTask(row: TasksTable, groupKey: string): TaskRow {
	return {
		pk: row.pk,
		id: row.id,
		groupPk: row.group_pk,
		groupKey,
		parentPk: row.parent_pk,
		title: row.title,
		description: row.description,
		status: row.status as TaskRow["status"],
		priority: row.priority,
		preferredModel: row.preferred_model,
		skills: jsonArrayFromDb(row.skills),
		mcps: jsonArrayFromDb(row.mcps),
		tags: jsonArrayFromDb(row.tags),
		acceptance: jsonAcceptanceFromDb(row.acceptance),
		assignee: row.assignee,
		claimOwner: row.claim_owner,
		claimExpires: row.claim_expires,
		descTokens: row.desc_tokens,
		commentCount: row.comment_count,
		archived: Boolean(row.archived),
		version: row.version,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function mapComment(row: CommentsTable, taskId: string): CommentRow {
	return {
		pk: row.pk,
		id: row.id,
		taskPk: row.task_pk,
		taskId,
		seq: row.seq,
		author: row.author,
		kind: row.kind,
		body: row.body,
		summary: row.summary,
		tokens: row.tokens,
		pinned: Boolean(row.pinned),
		replyToPk: row.reply_to_pk,
		compactedInto: row.compacted_into,
		createdAt: row.created_at,
	};
}

export function mapSection(row: ContextSectionsTable, groupKey: string): SectionRow {
	return {
		pk: row.pk,
		groupPk: row.group_pk,
		groupKey,
		slug: row.slug,
		title: row.title,
		body: row.body,
		position: row.position,
		tokens: row.tokens,
		alwaysInclude: Boolean(row.always_include),
		appliesTo: jsonArrayFromDb(row.applies_to),
		version: row.version,
		updatedAt: row.updated_at,
	};
}

export function mapEvent(row: EventsTable): EventRow {
	let diff: EventDiff = {};
	if (typeof row.diff === "string") {
		try {
			diff = JSON.parse(row.diff) as EventDiff;
		} catch {
			diff = {};
		}
	} else if (row.diff && typeof row.diff === "object") {
		diff = row.diff as EventDiff;
	}
	return {
		rev: Number(row.rev ?? 0),
		entity: row.entity,
		entityId: row.entity_id,
		groupKey: row.group_key,
		action: row.action,
		actor: row.actor,
		diff,
		at: row.at,
	};
}
