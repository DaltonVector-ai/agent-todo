import {
	ContextService,
	GroupService,
	Shaper,
	TaskService,
	commentDigest,
	renderContextSections,
	renderContextToc,
	renderGroupLine,
	renderTaskLine,
} from "@agent-todo/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./toolsets/shared.js";

export function registerTodoResources(server: McpServer, ctx: McpContext): void {
	const groups = new GroupService(ctx.store);
	const tasks = new TaskService(ctx.store);
	const contextSvc = new ContextService(ctx.store);
	const shaper = new Shaper(ctx.defaultMaxTokens);

	server.registerResource(
		"groups",
		"todo://groups",
		{
			title: "Task groups",
			description: "All groups with open/total counts",
		},
		async () => {
			const rows = await groups.list();
			const lines: string[] = [];
			for (const g of rows) {
				const summary = await groups.get(g.key);
				lines.push(
					renderGroupLine(g, { open: summary.openTasks, total: summary.totalTasks }),
				);
			}
			const text = lines.join("\n") || "none";
			return { contents: [{ uri: "todo://groups", mimeType: "text/plain", text }] };
		},
	);

	const groupContextTemplate = new ResourceTemplate("todo://group/{key}/context", {
		list: undefined,
	});
	server.registerResource(
		"group-context",
		groupContextTemplate,
		{
			title: "Group context TOC",
			description: "Table of contents for group context sections",
		},
		async (uri, { key }) => {
			const toc = await contextSvc.toc(String(key));
			const text = renderContextToc(String(key), toc);
			return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
		},
	);

	const sectionTemplate = new ResourceTemplate("todo://group/{key}/context/{slug}", {
		list: undefined,
	});
	server.registerResource(
		"group-context-section",
		sectionTemplate,
		{
			title: "Group context section",
			description: "One context section body",
		},
		async (uri, { key, slug }) => {
			const sections = await contextSvc.getSections(String(key), [String(slug)]);
			const text = sections.length ? renderContextSections(sections) : "NOT_FOUND";
			return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
		},
	);

	const taskTemplate = new ResourceTemplate("todo://task/{id}", { list: undefined });
	server.registerResource(
		"task-brief",
		taskTemplate,
		{
			title: "Task brief",
			description: "Task at brief detail level",
		},
		async (uri, { id }) => {
			const task = await ctx.store.tasks.getById(String(id));
			if (!task) {
				return {
					contents: [{ uri: uri.href, mimeType: "text/plain", text: "NOT_FOUND: task" }],
				};
			}
			const allComments = await ctx.store.comments.listByTask(task.id);
			const digest = commentDigest(allComments);
			const line = renderTaskLine(task, digest);
			return { contents: [{ uri: uri.href, mimeType: "text/plain", text: line }] };
		},
	);

	const boardTemplate = new ResourceTemplate("todo://group/{key}/board", { list: undefined });
	server.registerResource(
		"group-board",
		boardTemplate,
		{
			title: "Group board",
			description: "Status counts and top open tasks",
		},
		async (uri, { key }) => {
			const groupKey = String(key);
			const summary = await groups.get(groupKey);
			const all = await ctx.store.tasks.listByGroup(groupKey);
			const active = all.filter((t) => !t.archived);
			const counts = new Map<string, number>();
			for (const t of active) {
				counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
			}
			const countLine = [...counts.entries()]
				.map(([status, n]) => `${status}:${n}`)
				.join(" ");
			const open = active
				.filter((t) => t.status === "open" || t.status === "reopen")
				.sort((a, b) => a.priority - b.priority)
				.slice(0, 8);
			const lines = [
				`${groupKey} · ${summary.openTasks}/${summary.totalTasks} open`,
				countLine,
				...open.map((t) => renderTaskLine(t)),
			];
			const text = shaper.renderRead(lines.join("\n"), { maxTokens: 800 }).text;
			return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
		},
	);
}
