import { randomUUID } from "node:crypto";
import type { Store } from "@agent-todo/core";
import { createMcpServer } from "@agent-todo/mcp";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { authorizeBearer, isAllowedBrowserOrigin, parseLocalTokens } from "./auth/localTokens.js";
import { findBoardAsset } from "./boardAssets.js";
import type { ChangeHub } from "./changeHub.js";
import { metricsText, observeTool } from "./metrics.js";
import { QuotaExceededError } from "./quotas.js";
import { parseMinRevHeader, runWithRequestContext } from "./requestContext.js";
import { createChangeStream } from "./sse.js";
import type { PushPayload } from "./sync/payload.js";
import { buildBoardPayload, isGroupAllowed, listBoardGroups, taskDrawerPayload } from "./boardData.js";
import { isBoardPublicGet } from "./boardPublic.js";
import { buildPushPayload, exportProjectJsonl } from "./sync/projectTransfer.js";

export type AgentTodoRequestContext = {
	store: Store;
	toolsets?: string[];
	actorName: string;
	groupAllowList?: string[];
	projectPk?: string;
	tokenPk?: string;
};

export type CreateAppOptions = {
	store?: Store;
	changeHub: ChangeHub;
	toolsets?: string[];
	defaultMaxTokens?: number;
	onActivity?: () => void;
	resolveContext?: (
		authHeader: string | undefined,
	) => Promise<AgentTodoRequestContext | null> | AgentTodoRequestContext | null;
	readyCheck?: () => Promise<boolean>;
	allowBrowserOrigin?: (origin: string | undefined) => boolean;
	onPush?: (payload: PushPayload, ctx: AgentTodoRequestContext) => Promise<void>;
	getMcpResourceUpdates?: () => Array<{ projectPk: string; groupKey?: string }>;
};

function isPublicPath(path: string): boolean {
	return (
		path === "/health" ||
		path === "/ready" ||
		path === "/metrics" ||
		path.startsWith("/.well-known/") ||
		path.startsWith("/oauth/") ||
		path === "/api/bootstrap"
	);
}

export function createApp(
	opts: CreateAppOptions,
): Hono<{ Variables: { agentTodo?: AgentTodoRequestContext } }> {
	const tokens = parseLocalTokens();
	const app = new Hono<{ Variables: { agentTodo?: AgentTodoRequestContext } }>();

	const touch = () => opts.onActivity?.();

	const originAllowed = (origin: string | undefined) =>
		opts.allowBrowserOrigin ? opts.allowBrowserOrigin(origin) : isAllowedBrowserOrigin(origin);

	app.use("*", async (c, next) => {
		const started = Date.now();
		const requestId = c.req.header("x-request-id") ?? randomUUID();
		const minRev = parseMinRevHeader(c.req.header("x-min-rev"));

		const handle = async () => {
			if (isPublicPath(c.req.path)) {
				await next();
				return;
			}
			if (isBoardPublicGet(c.req.path, c.req.method)) {
				const origin = c.req.header("origin");
				if (!originAllowed(origin)) {
					return c.text("origin not allowed", 403);
				}
				await next();
				return;
			}
			const origin = c.req.header("origin");
			if (!originAllowed(origin)) {
				return c.text("origin not allowed", 403);
			}
			try {
				if (opts.resolveContext) {
					const ctx = await opts.resolveContext(c.req.header("authorization"));
					if (!ctx) return c.text("unauthorized", 401);
					c.set("agentTodo", ctx);
				} else {
					const auth = authorizeBearer(c.req.header("authorization"), tokens);
					if (!auth.ok) return c.text("unauthorized", 401);
					if (!opts.store) return c.text("server misconfigured", 500);
					c.set("agentTodo", {
						store: opts.store,
						toolsets: opts.toolsets,
						actorName: auth.name,
					});
				}
				const ctx = c.get("agentTodo");
				await runWithRequestContext(
					{
						minRev,
						requestId,
						projectPk: ctx?.projectPk,
						tokenPk: ctx?.tokenPk,
					},
					async () => {
						await next();
					},
				);
			} catch (e) {
				if (e instanceof QuotaExceededError) {
					return c.json({ error: "BUDGET", message: e.message, bucket: e.bucket }, 429);
				}
				throw e;
			}
		};

		await handle();

		const ctx = c.get("agentTodo");
		const durationMs = Date.now() - started;
		console.info(
			JSON.stringify({
				level: "info",
				request_id: requestId,
				path: c.req.path,
				method: c.req.method,
				status: c.res.status,
				duration_ms: durationMs,
				project: ctx?.projectPk,
			}),
		);
	});

	const ctxOf = (c: { get: (k: "agentTodo") => AgentTodoRequestContext | undefined }) => {
		const fromReq = c.get("agentTodo");
		if (fromReq) return fromReq;
		if (!opts.store) throw new Error("missing store context");
		return { store: opts.store, toolsets: opts.toolsets, actorName: "localhost" };
	};

	app.get("/health", (c) => {
		touch();
		return c.json({ status: "ok" });
	});

	app.get("/ready", async (c) => {
		touch();
		if (opts.readyCheck) {
			const ok = await opts.readyCheck();
			if (!ok) return c.json({ status: "not_ready" }, 503);
		}
		return c.json({ status: "ready" });
	});

	app.get("/metrics", async (c) => {
		const body = await metricsText();
		return c.text(body, 200, { "Content-Type": "text/plain; version=0.0.4" });
	});

	app.get("/api/events/stream", (c) => {
		touch();
		return new Response(createChangeStream(opts.changeHub, c.req.raw.signal), {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	});

	app.get("/api/groups", async (c) => {
		touch();
		const ctx = ctxOf(c);
		const payload = await listBoardGroups(ctx.store);
		if (ctx.groupAllowList?.length) {
			payload.groups = payload.groups.filter((g) => isGroupAllowed(ctx, g.key));
		}
		return c.json(payload);
	});

	app.get("/api/board", async (c) => {
		touch();
		const ctx = ctxOf(c);
		return c.json(await buildBoardPayload(ctx.store, ctx));
	});

	app.get("/api/groups/:groupKey/tasks/:taskId", async (c) => {
		touch();
		const ctx = ctxOf(c);
		const groupKey = c.req.param("groupKey");
		if (!isGroupAllowed(ctx, groupKey)) return c.text("not found", 404);
		const taskId = c.req.param("taskId");
		const task = await ctx.store.tasks.getById(taskId);
		if (!task || task.groupKey !== groupKey) return c.text("not found", 404);
		const comments = await ctx.store.comments.listByTask(taskId);
		return c.json(taskDrawerPayload(task, comments));
	});

	app.get("/api/groups/:groupKey/context", async (c) => {
		touch();
		const ctx = ctxOf(c);
		const groupKey = c.req.param("groupKey");
		if (!isGroupAllowed(ctx, groupKey)) return c.text("not found", 404);
		const { store } = ctx;
		const group = await store.groups.getByKey(groupKey);
		if (!group || group.archived) return c.text("not found", 404);
		const sections = await store.sections.listByGroup(groupKey);
		const toc = sections.map((s) => ({
			slug: s.slug,
			title: s.title,
			position: s.position,
			tokens: s.tokens,
		}));
		return c.json({ group: { key: group.key, name: group.name }, toc, sections });
	});

	app.post("/api/sync/push", async (c) => {
		touch();
		const ctx = ctxOf(c);
		const payload = (await c.req.json()) as PushPayload;
		if (opts.onPush) {
			await opts.onPush(payload, ctx);
		} else {
			return c.text("push not configured", 501);
		}
		return c.json({ ok: true });
	});

	app.get("/api/sync/export", async (c) => {
		touch();
		const { store } = ctxOf(c);
		const format = c.req.query("format") ?? "json";
		const payload = await buildPushPayload(store);
		if (format === "jsonl") {
			const body = await exportProjectJsonl(payload);
			return c.text(body, 200, { "Content-Type": "application/x-ndjson" });
		}
		return c.json(payload);
	});

	app.get("/mcp", (c) => {
		return c.text("Method Not Allowed", 405);
	});

	app.post("/mcp", async (c) => {
		touch();
		const { store, toolsets, projectPk } = ctxOf(c);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		const server = createMcpServer({
			store,
			toolsets,
			defaultMaxTokens: opts.defaultMaxTokens,
			onToolCall: (name, startMs) => {
				observeTool(name, Date.now() - startMs);
			},
			resourceUpdates: opts.getMcpResourceUpdates,
			projectPk,
		});
		await server.connect(transport);
		return transport.handleRequest(c.req.raw);
	});

	app.get("/*", (c) => {
		touch();
		const asset = findBoardAsset(c.req.path);
		if (!asset) return c.text("not found", 404);
		return new Response(asset.content, {
			headers: { "Content-Type": asset.contentType },
		});
	});

	return app;
}
