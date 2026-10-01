import { COMMENT_KINDS, TASK_STATUSES } from "@agent-todo/core";
import * as z from "zod/v4";

const statusEnum = z.enum(TASK_STATUSES);
const commentKindEnum = z.enum(COMMENT_KINDS);

const agent = z.string().optional().describe("Actor");
const view = z.enum(["id", "line", "brief", "full"]).optional().describe("Detail");
const format = z.enum(["text", "json"]).optional().describe("Output");
const fields = z.array(z.string()).optional().describe("Fields");
const max_tokens = z.number().int().positive().optional().describe("Token cap");
const limit = z.number().int().min(1).max(100).optional().describe("Page size");
const cursor = z.string().optional().describe("Cursor");

const readShape = { agent, view, fields, max_tokens, format };
const listShape = { ...readShape, limit, cursor };

export const coreToolInputSchemas = {
	task_next: {
		...readShape,
		group: z.string().optional().describe("Group"),
		tags: z.array(z.string()).optional().describe("Tags"),
		model: z.string().optional().describe("Model"),
		skills: z.array(z.string()).optional().describe("Skills"),
		claim: z.boolean().optional().describe("Claim"),
		ttl_min: z.number().int().positive().optional().describe("Lease min"),
	},
	task_get: {
		...readShape,
		id: z.string().describe("Task id"),
		include: z
			.array(z.enum(["comments", "deps", "history", "context"]))
			.optional()
			.describe("Extras"),
	},
	task_list: {
		...listShape,
		group: z.string().optional().describe("Group"),
		status: z.array(statusEnum).optional().describe("Statuses"),
		tags: z.array(z.string()).optional().describe("Tags"),
		assignee: z.string().optional().describe("Assignee"),
		q: z.string().optional().describe("Search"),
		sort: z.enum(["priority", "updated"]).optional().describe("Sort"),
	},
	task_create: {
		agent,
		group: z.string().describe("Group"),
		tasks: z
			.array(
				z.object({
					title: z.string(),
					description: z.string().optional(),
					priority: z.number().int().optional(),
					preferred_model: z.string().nullable().optional(),
					skills: z.array(z.string()).optional(),
					mcps: z.array(z.string()).optional(),
					tags: z.array(z.string()).optional(),
					depends_on: z.array(z.string()).optional(),
					parent: z.string().optional(),
					acceptance: z.array(z.object({ text: z.string(), done: z.boolean() })).optional(),
				}),
			)
			.min(1)
			.max(50),
		echo: z.boolean().optional().describe("Echo full"),
	},
	task_update: {
		agent,
		id: z.string().describe("Task id"),
		v: z.number().int().describe("Version"),
		set: z
			.object({
				title: z.string().optional(),
				description: z.string().optional(),
				priority: z.number().int().optional(),
				preferred_model: z.string().nullable().optional(),
				assignee: z.string().nullable().optional(),
			})
			.optional(),
		append_description: z.string().optional(),
		add: z
			.object({
				tags: z.array(z.string()).optional(),
				skills: z.array(z.string()).optional(),
				mcps: z.array(z.string()).optional(),
			})
			.optional(),
		remove: z
			.object({
				tags: z.array(z.string()).optional(),
				skills: z.array(z.string()).optional(),
				mcps: z.array(z.string()).optional(),
			})
			.optional(),
		force: z.boolean().optional(),
		echo: z.boolean().optional(),
	},
	task_status: {
		agent,
		id: z.string().describe("Task id"),
		v: z.number().int().describe("Version"),
		to: statusEnum.describe("Status"),
		comment: z
			.object({
				body: z.string(),
				kind: commentKindEnum.optional(),
			})
			.optional(),
		force: z.boolean().optional(),
		reason: z.string().optional(),
		echo: z.boolean().optional(),
	},
	comment_add: {
		agent,
		task: z.string().describe("Task id"),
		body: z.string().describe("Body"),
		kind: commentKindEnum.optional().describe("Kind"),
		summary: z.string().optional(),
		pinned: z.boolean().optional(),
		reply_to: z.string().optional(),
	},
	comment_list: {
		...readShape,
		task: z.string().describe("Task id"),
		since: z.string().optional().describe("After id"),
		kinds: z.array(commentKindEnum).optional(),
		ids: z.array(z.string()).optional(),
		view: z.enum(["summary", "full"]).optional().describe("Detail"),
		include_compacted: z.boolean().optional(),
	},
	context_get: {
		...readShape,
		group: z.string().describe("Group"),
		sections: z.array(z.string()).optional().describe("Slugs"),
		for_task: z.string().optional().describe("Task id"),
	},
	changes_since: {
		...readShape,
		rev: z.number().int().nonnegative().describe("Since rev"),
		group: z.string().optional().describe("Group"),
		entities: z.array(z.string()).optional().describe("Entities"),
	},
} as const;

export const CORE_TOOL_NAMES = [
	"task_next",
	"task_get",
	"task_list",
	"task_create",
	"task_update",
	"task_status",
	"comment_add",
	"comment_list",
	"context_get",
	"changes_since",
] as const;

export const TOOL_DESCRIPTIONS: Record<(typeof CORE_TOOL_NAMES)[number], string> = {
	task_next: "Claim next open task bundle.",
	task_get: "Get one task.",
	task_list: "List tasks.",
	task_create: "Create tasks.",
	task_update: "Update task.",
	task_status: "Set task status.",
	comment_add: "Add comment.",
	comment_list: "List comments.",
	context_get: "Get group context.",
	changes_since: "Events since rev.",
};

/** MCP-shaped tool defs for token budget CI (matches listTools payload). */
export function serializeCoreToolSchemasForBudget(): string {
	const tools = CORE_TOOL_NAMES.map((name) => ({
		name,
		description: TOOL_DESCRIPTIONS[name],
		inputSchema: compactSchemas[name],
	}));
	return JSON.stringify(tools);
}

const compactSchemas: Record<(typeof CORE_TOOL_NAMES)[number], Record<string, unknown>> = {
	task_next: {
		type: "object",
		properties: {
			...sharedRead(),
			group: { type: "string" },
			tags: { type: "array", items: { type: "string" } },
			model: { type: "string" },
			skills: { type: "array", items: { type: "string" } },
			claim: { type: "boolean" },
			ttl_min: { type: "integer" },
		},
	},
	task_get: {
		type: "object",
		properties: {
			...sharedRead(),
			id: { type: "string" },
			include: {
				type: "array",
				items: { type: "string", enum: ["comments", "deps", "history", "context"] },
			},
		},
		required: ["id"],
	},
	task_list: {
		type: "object",
		properties: {
			...sharedList(),
			group: { type: "string" },
			status: { type: "array", items: { type: "string", enum: TASK_STATUSES } },
			tags: { type: "array", items: { type: "string" } },
			assignee: { type: "string" },
			q: { type: "string" },
			sort: { type: "string", enum: ["priority", "updated"] },
		},
	},
	task_create: {
		type: "object",
		properties: {
			agent: { type: "string" },
			group: { type: "string" },
			tasks: { type: "array", items: { type: "object" } },
			echo: { type: "boolean" },
		},
		required: ["group", "tasks"],
	},
	task_update: {
		type: "object",
		properties: {
			agent: { type: "string" },
			id: { type: "string" },
			v: { type: "integer" },
			set: { type: "object" },
			append_description: { type: "string" },
			add: { type: "object" },
			remove: { type: "object" },
			force: { type: "boolean" },
			echo: { type: "boolean" },
		},
		required: ["id", "v"],
	},
	task_status: {
		type: "object",
		properties: {
			agent: { type: "string" },
			id: { type: "string" },
			v: { type: "integer" },
			to: { type: "string", enum: TASK_STATUSES },
			comment: { type: "object" },
			force: { type: "boolean" },
			reason: { type: "string" },
			echo: { type: "boolean" },
		},
		required: ["id", "v", "to"],
	},
	comment_add: {
		type: "object",
		properties: {
			agent: { type: "string" },
			task: { type: "string" },
			body: { type: "string" },
			kind: { type: "string", enum: COMMENT_KINDS },
			summary: { type: "string" },
			pinned: { type: "boolean" },
			reply_to: { type: "string" },
		},
		required: ["task", "body"],
	},
	comment_list: {
		type: "object",
		properties: {
			...sharedRead(),
			task: { type: "string" },
			since: { type: "string" },
			kinds: { type: "array", items: { type: "string", enum: COMMENT_KINDS } },
			ids: { type: "array", items: { type: "string" } },
			view: { type: "string", enum: ["summary", "full"] },
			include_compacted: { type: "boolean" },
		},
		required: ["task"],
	},
	context_get: {
		type: "object",
		properties: {
			...sharedRead(),
			group: { type: "string" },
			sections: { type: "array", items: { type: "string" } },
			for_task: { type: "string" },
		},
		required: ["group"],
	},
	changes_since: {
		type: "object",
		properties: {
			...sharedRead(),
			rev: { type: "integer" },
			group: { type: "string" },
			entities: { type: "array", items: { type: "string" } },
		},
		required: ["rev"],
	},
};

function sharedRead(): Record<string, unknown> {
	return {
		agent: { type: "string" },
		view: { type: "string", enum: ["id", "line", "brief", "full"] },
		fields: { type: "array", items: { type: "string" } },
		max_tokens: { type: "integer" },
		format: { type: "string", enum: ["text", "json"] },
	};
}

function sharedList(): Record<string, unknown> {
	return {
		...sharedRead(),
		limit: { type: "integer" },
		cursor: { type: "string" },
	};
}
