import { type Store, TASK_STATUSES } from "@agent-todo/core";
import { createMcpServer } from "@agent-todo/mcp";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { authorizeBearer, isAllowedBrowserOrigin, parseLocalTokens } from "./auth/localTokens.js";
import { findBoardAsset } from "./boardAssets.js";
import type { ChangeHub } from "./changeHub.js";
import { createChangeStream } from "./sse.js";

export type CreateAppOptions = {
	store: Store;
	changeHub: ChangeHub;
	toolsets?: string[];
	defaultMaxTokens?: number;
	onActivity?: () => void;
};

export function createApp(opts: CreateAppOptions): Hono {
	const tokens = parseLocalTokens();
	const app = new Hono();

	const touch = () => opts.onActivity?.();

	const guard = (c: { req: { header: (n: string) => string | undefined } }) => {
		const origin = c.req.header("origin");
		if (!isAllowedBrowserOrigin(origin)) {
			return { blocked: true as const, status: 403 as const, message: "origin not allowed" };
		}
		const auth = authorizeBearer(c.req.header("authorization"), tokens);
		if (!auth.ok) {
			return { blocked: true as const, status: 401 as const, message: "unauthorized" };
		}
		return { blocked: false as const };
	};

	app.get("/health", (c) => {
		touch();
		return c.json({ status: "ok" });
	});

	app.get("/api/events/stream", (c) => {
		const g = guard(c);
		if (g.blocked) return c.text(g.message, g.status);
		touch();
		return new Response(createChangeStream(opts.changeHub, c.req.raw.signal), {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	});

	app.get("/api/board", async (c) => {
		const g = guard(c);
		if (g.blocked) return c.text(g.message, g.status);
		touch();
		const groups = await opts.store.groups.list();
		const columns: Record<string, unknown[]> = {};
		for (const status of TASK_STATUSES) columns[status] = [];

		for (const group of groups) {
			const tasks = await opts.store.tasks.listByGroup(group.key);
			for (const task of tasks) {
				if (task.archived) continue;
				const col = columns[task.status];
				if (col) {
					col.push({
						id: task.id,
						groupKey: task.groupKey,
						title: task.title,
						status: task.status,
						priority: task.priority,
						claimOwner: task.claimOwner,
					});
				}
			}
		}

		const rev = await opts.store.events.latestRev();
		return c.json({ rev, groups: groups.map((g) => ({ key: g.key, name: g.name })), columns });
	});

	app.get("/api/groups/:groupKey/tasks/:taskId", async (c) => {
		const g = guard(c);
		if (g.blocked) return c.text(g.message, g.status);
		touch();
		const taskId = c.req.param("taskId");
		const task = await opts.store.tasks.getById(taskId);
		if (!task) return c.text("not found", 404);
		const comments = await opts.store.comments.listByTask(taskId);
		const summaries = comments.slice(-10).map((cm) => ({
			id: cm.id,
			kind: cm.kind,
			author: cm.author,
			body: cm.body.slice(0, 200),
		}));
		return c.json({ task, comments: summaries });
	});

	app.get("/api/groups/:groupKey/context", async (c) => {
		const g = guard(c);
		if (g.blocked) return c.text(g.message, g.status);
		touch();
		const groupKey = c.req.param("groupKey");
		const group = await opts.store.groups.getByKey(groupKey);
		if (!group) return c.text("not found", 404);
		const sections = await opts.store.sections.listByGroup(groupKey);
		const toc = sections.map((s) => ({
			slug: s.slug,
			title: s.title,
			position: s.position,
			tokens: s.tokens,
		}));
		return c.json({ group: { key: group.key, name: group.name }, toc, sections });
	});

	app.get("/mcp", (c) => {
		const g = guard(c);
		if (g.blocked) return c.text(g.message, g.status);
		// Stateless JSON MCP: clients fall back to POST-only when GET is unavailable.
		return c.text("Method Not Allowed", 405);
	});

	app.post("/mcp", async (c) => {
		const g = guard(c);
		if (g.blocked) return c.text(g.message, g.status);
		touch();
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		const server = createMcpServer({
			store: opts.store,
			toolsets: opts.toolsets,
			defaultMaxTokens: opts.defaultMaxTokens,
		});
		await server.connect(transport);
		return transport.handleRequest(c.req.raw);
	});

	app.get("/*", (c) => {
		const g = guard(c);
		if (g.blocked) return c.text(g.message, g.status);
		touch();
		const asset = findBoardAsset(c.req.path);
		if (!asset) return c.text("not found", 404);
		return new Response(asset.content, {
			headers: { "Content-Type": asset.contentType },
		});
	});

	return app;
}
