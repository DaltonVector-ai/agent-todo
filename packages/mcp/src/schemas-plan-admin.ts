import { COMMENT_KINDS, TASK_STATUSES } from "@agent-todo/core";
import * as z from "zod/v4";
import { CORE_TOOL_NAMES, serializeCoreToolSchemasForBudget } from "./schemas.js";

const agent = z.string().optional().describe("Actor");
const readShape = {
	agent,
	view: z.enum(["id", "line", "brief", "full"]).optional().describe("Detail"),
	fields: z.array(z.string()).optional().describe("Fields"),
	max_tokens: z.number().int().positive().optional().describe("Token cap"),
	format: z.enum(["text", "json"]).optional().describe("Output"),
};

export const PLAN_TOOL_NAMES = [
	"group_create",
	"group_update",
	"group_list",
	"group_get",
	"context_update",
	"context_import",
	"context_export",
	"comment_compact",
	"task_claim",
	"task_release",
	"task_move",
] as const;

export const ADMIN_TOOL_NAMES = ["task_archive", "group_archive", "history"] as const;

export const planToolInputSchemas = {
	group_create: {
		agent,
		name: z.string().describe("Name"),
		key: z.string().optional().describe("Key"),
		summary: z.string().optional().describe("Summary"),
		defaults: z
			.object({
				default_model: z.string().nullable().optional(),
				default_skills: z.array(z.string()).optional(),
				default_mcps: z.array(z.string()).optional(),
			})
			.optional(),
		context_markdown: z.string().optional().describe("Import md"),
	},
	group_update: {
		agent,
		key: z.string().describe("Group key"),
		v: z.number().int().describe("Version"),
		set: z
			.object({
				name: z.string().optional(),
				summary: z.string().optional(),
				defaults: z
					.object({
						default_model: z.string().nullable().optional(),
						default_skills: z.array(z.string()).optional(),
						default_mcps: z.array(z.string()).optional(),
					})
					.optional(),
			})
			.optional(),
	},
	group_list: {
		...readShape,
		archived: z.boolean().optional().describe("Archived"),
	},
	group_get: {
		...readShape,
		key: z.string().describe("Group key"),
	},
	context_update: {
		agent,
		group: z.string().describe("Group"),
		v: z.number().int().optional().describe("Section v"),
		ops: z.array(z.record(z.string(), z.unknown())).min(1),
	},
	context_import: {
		agent,
		group: z.string().describe("Group"),
		markdown: z.string().describe("Markdown"),
		mode: z.enum(["merge", "replace"]).optional().describe("Mode"),
	},
	context_export: {
		agent,
		group: z.string().describe("Group"),
		flavor: z.enum(["claude_md", "agents_md", "plain", "stub"]).describe("Flavor"),
		sections: z.array(z.string()).optional().describe("Slugs"),
	},
	comment_compact: {
		agent,
		task: z.string().describe("Task id"),
		summary_body: z.string().describe("Summary"),
		supersedes: z.union([z.array(z.string()), z.literal("all")]).optional(),
		keep_pinned: z.boolean().optional(),
	},
	task_claim: {
		agent,
		id: z.string().describe("Task id"),
		ttl_min: z.number().int().positive().optional().describe("Lease min"),
	},
	task_release: {
		agent,
		id: z.string().describe("Task id"),
		to_status: z.enum(["open", "todo"]).optional().describe("Status"),
	},
	task_move: {
		agent,
		id: z.string().describe("Task id"),
		group: z.string().describe("Target group"),
	},
} as const;

export const adminToolInputSchemas = {
	task_archive: {
		agent,
		id: z.string().describe("Task id"),
		reason: z.string().describe("Reason"),
		hard: z.boolean().optional().describe("Hard delete"),
	},
	group_archive: {
		agent,
		key: z.string().describe("Group key"),
	},
	history: {
		...readShape,
		id: z.string().describe("Task or group id"),
	},
} as const;

export const PLAN_DESCRIPTIONS: Record<(typeof PLAN_TOOL_NAMES)[number], string> = {
	group_create: "Create a task group.",
	group_update: "Update group metadata.",
	group_list: "List groups.",
	group_get: "Get group summary and context TOC.",
	context_update: "Patch context sections.",
	context_import: "Import markdown sections.",
	context_export: "Export context markdown.",
	comment_compact: "Compact task comments.",
	task_claim: "Claim a task.",
	task_release: "Release a task claim.",
	task_move: "Move task to another group.",
};

export const ADMIN_DESCRIPTIONS: Record<(typeof ADMIN_TOOL_NAMES)[number], string> = {
	task_archive: "Archive a task.",
	group_archive: "Archive a group.",
	history: "List entity event history.",
};

const CONTEXT_GENERATE_DESCRIPTION = "Draft context via client sampling.";

function serializePlanToolsForBudget(): Array<{
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}> {
	return PLAN_TOOL_NAMES.map((name) => ({
		name,
		description: PLAN_DESCRIPTIONS[name],
		inputSchema: { type: "object", properties: {} },
	}));
}

function serializeAdminToolsForBudget(): Array<{
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}> {
	return ADMIN_TOOL_NAMES.map((name) => ({
		name,
		description: ADMIN_DESCRIPTIONS[name],
		inputSchema: { type: "object", properties: {} },
	}));
}

/** Plan toolset only (token budget regression). */
export function serializePlanToolSchemasForBudget(): string {
	return JSON.stringify(serializePlanToolsForBudget());
}

/** Admin toolset only (token budget regression). */
export function serializeAdminToolSchemasForBudget(): string {
	return JSON.stringify(serializeAdminToolsForBudget());
}

/** Full MCP tool list JSON for ≤5k token budget CI. */
export function serializeAllToolSchemasForBudget(): string {
	const core = JSON.parse(serializeCoreToolSchemasForBudget()) as Array<{
		name: string;
		description: string;
		inputSchema: Record<string, unknown>;
	}>;
	const plan = serializePlanToolsForBudget();
	const admin = serializeAdminToolsForBudget();
	const optional = [
		{
			name: "context_generate",
			description: CONTEXT_GENERATE_DESCRIPTION,
			inputSchema: { type: "object", properties: { group: { type: "string" } } },
		},
	];
	return JSON.stringify([...core, ...plan, ...admin, ...optional]);
}

export function listRegisteredToolNames(toolsets: string[]): string[] {
	const set = new Set(toolsets.length ? toolsets : ["core"]);
	const names: string[] = [];
	if (set.has("core")) names.push(...CORE_TOOL_NAMES);
	if (set.has("plan")) names.push(...PLAN_TOOL_NAMES);
	if (set.has("admin")) names.push(...ADMIN_TOOL_NAMES);
	return names;
}
