import { ContextService } from "@agent-todo/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { parseContextOps } from "./contextOps.js";
import { actor, type McpContext, makeShaper, toolError, withToolTelemetry } from "./shared.js";

export type MachineProjectTools = {
	listProjects(): Promise<Array<{ code: string; name: string; path: string }>>;
	listGroups(projectCode: string): Promise<Array<{ id: string; name: string }>>;
	createGroup(input: { projectCode: string; name: string }): Promise<{ id: string; name: string }>;
};

const projectCode = z.string().min(1).describe("Project code");

function jsonResult(payload: Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(payload) }],
		structuredContent: payload,
	};
}

export function registerMachineProjectTools(
	server: McpServer,
	ctx: McpContext,
	projects: MachineProjectTools,
): void {
	const contextSvc = new ContextService(ctx.store);

	server.registerTool(
		"project_list",
		{
			description: "List projects. Each project includes its code, name, and path.",
			inputSchema: {},
		},
		async () =>
			withToolTelemetry(ctx, "project_list", async () => {
				try {
					return jsonResult({ projects: await projects.listProjects() });
				} catch (e) {
					return toolError(e);
				}
			}),
	);

	server.registerTool(
		"group_list",
		{
			description: "List groups for one project. Requires the project code.",
			inputSchema: { project: projectCode },
		},
		async (args) =>
			withToolTelemetry(ctx, "group_list", async () => {
				const project = (args as { project: string }).project;
				try {
					return jsonResult({ groups: await projects.listGroups(project) });
				} catch (e) {
					return toolError(e);
				}
			}),
	);

	server.registerTool(
		"group_create",
		{
			description:
				"Create a group in a project. Requires the project code and a name. The server assigns the group id.",
			inputSchema: {
				project: projectCode,
				name: z.string().min(1).describe("Name"),
			},
		},
		async (args) =>
			withToolTelemetry(ctx, "group_create", async () => {
				const a = args as { project: string; name: string };
				try {
					const created = await projects.createGroup({
						projectCode: a.project,
						name: a.name,
					});
					return jsonResult(created);
				} catch (e) {
					return toolError(e);
				}
			}),
	);

	server.registerTool(
		"context_update",
		{
			description: "Patch context sections for one group. Requires the group id.",
			inputSchema: {
				agent: z.string().optional().describe("Actor"),
				group: z.string().min(1).describe("Group id"),
				v: z.number().int().optional().describe("Section v"),
				ops: z.array(z.record(z.string(), z.unknown())).min(1),
			},
		},
		async (args) =>
			withToolTelemetry(ctx, "context_update", async () => {
				const a = args as {
					agent?: string;
					group: string;
					v?: number;
					ops: Array<Record<string, unknown>>;
				};
				const shaped = makeShaper(ctx);
				try {
					const updated = await contextSvc.applyOps(a.group, parseContextOps(a.ops), {
						v: a.v,
						actor: actor(ctx, a.agent),
					});
					const sections = updated.map((section) => ({
						slug: section.slug,
						v: section.version,
						tokens: section.tokens,
					}));
					return shaped.toMcpContent(shaped.renderRead({ sections }, { format: "json" }));
				} catch (e) {
					return toolError(e);
				}
			}),
	);
}
