import { randomUUID } from "node:crypto";
import { type Store, TASK_STATUSES } from "@agent-todo/core";
import { createMcpServer, type MachineProjectTools } from "@agent-todo/mcp";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
	authorizeBearer,
	isAllowedBrowserOrigin,
	type LocalToken,
	parseLocalTokens,
} from "./auth/localTokens.js";
import type { MachineDashboardAuth } from "./auth/machineAuth.js";
import { findBoardAsset } from "./boardAssets.js";
import {
	buildBoardPayload,
	isGroupAllowed,
	listBoardGroups,
	taskDrawerPayload,
} from "./boardData.js";
import { isBoardPublicGet, isBoardRead } from "./boardPublic.js";
import type { ChangeHub } from "./changeHub.js";
import { metricsText, observeTool } from "./metrics.js";
import { mountOAuthMetadata } from "./oauth/metadata.js";
import { QuotaExceededError } from "./quotas.js";
import {
	DirectoryRegistrationError,
	type ProjectDirectoryRegistry,
	type ProjectListItem,
	registerDirectory,
} from "./registerDirectory.js";
import { parseMinRevHeader, runWithRequestContext } from "./requestContext.js";
import { scopeStore } from "./scopeStore.js";
import { createChangeStream } from "./sse.js";
import type { PushPayload } from "./sync/payload.js";
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
	/** When set, replaces AGENT_TODO_TOKENS. An empty list leaves the daemon open. */
	localTokens?: LocalToken[];
	/** Cloud board reads. `store: null` is an empty project and must not fall through to another tenant. */
	publicBoard?: {
		store: Store | null;
		projectPk: string | null;
		/** The one project the board client should open. Omitted projects fall back to `projectPk`. */
		project?: ProjectListItem | null;
	};
	resolveContext?: (
		authHeader: string | undefined,
	) => Promise<AgentTodoRequestContext | null> | AgentTodoRequestContext | null;
	readyCheck?: () => Promise<boolean>;
	allowBrowserOrigin?: (origin: string | undefined) => boolean;
	onPush?: (payload: PushPayload, ctx: AgentTodoRequestContext) => Promise<void>;
	getMcpResourceUpdates?: () => Array<{ projectPk: string; groupKey?: string }>;
	/** Machine daemon: register directories and list projects. Absent on the per-project daemon. */
	projects?: ProjectDirectoryRegistry;
	/** Machine daemon: board and project APIs require sign-in (no open reads). */
	secureMachineBoard?: boolean;
	/** Machine daemon: password sign-in for MCP bearer tokens. */
	machineSignIn?: (
		username: string,
		password: string,
	) => Promise<{ token: string } | null> | { token: string } | null;
	/** Machine daemon: dashboard session cookie auth for the board SPA. */
	machineDashboard?: MachineDashboardAuth;
	/** Mounts OAuth discovery before the board catch-all. */
	publicUrl?: string;
};

function listedPublicProjects(
	board: NonNullable<CreateAppOptions["publicBoard"]>,
): ProjectListItem[] {
	if (!board.store || !board.projectPk) return [];
	if (board.project) return [board.project];
	return [{ code: board.projectPk, name: board.projectPk, path: board.projectPk }];
}

function machineProjectTools(projects: ProjectDirectoryRegistry): MachineProjectTools {
	return {
		listProjects: () => projects.listProjects(),
		listGroups: (projectCode) => projects.listProjectGroups(projectCode),
		createGroup: (input) => projects.createProjectGroup(input),
	};
}

function isPublicPath(path: string, method: string): boolean {
	if (path === "/api/auth/sign-in" && method === "POST") return true;
	if (path === "/api/auth/dashboard/sign-in" && method === "POST") return true;
	if (path === "/api/auth/session" && method === "GET") return true;
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
	const tokens = opts.localTokens ?? parseLocalTokens();
	const app = new Hono<{ Variables: { agentTodo?: AgentTodoRequestContext } }>();

	const touch = () => opts.onActivity?.();

	const originAllowed = (origin: string | undefined) =>
		opts.allowBrowserOrigin ? opts.allowBrowserOrigin(origin) : isAllowedBrowserOrigin(origin);

	app.use("*", async (c, next) => {
		const started = Date.now();
		const requestId = c.req.header("x-request-id") ?? randomUUID();
		const minRev = parseMinRevHeader(c.req.header("x-min-rev"));

		const handle = async (): Promise<Response | undefined> => {
			if (isPublicPath(c.req.path, c.req.method)) {
				await next();
				return;
			}
			const daemonBoardRead =
				Boolean(opts.store) &&
				!opts.resolveContext &&
				!opts.secureMachineBoard &&
				isBoardRead(c.req.path, c.req.method);
			const cloudBoardRead =
				opts.publicBoard !== undefined && isBoardRead(c.req.path, c.req.method);
			if (isBoardPublicGet(c.req.path, c.req.method) || daemonBoardRead || cloudBoardRead) {
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
					const mcpOnly = c.req.path === "/mcp" && c.req.method === "POST";
					let ctx = await opts.resolveContext(c.req.header("authorization"));
					if (!ctx && !mcpOnly && opts.machineDashboard) {
						const sessionToken = getCookie(c, opts.machineDashboard.cookieName);
						ctx = await opts.machineDashboard.resolveSession(sessionToken);
					}
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
			return;
		};

		const early = await handle();
		if (early) return early;

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

	const publicStoreOrRequestContext = (c: {
		get: (k: "agentTodo") => AgentTodoRequestContext | undefined;
	}): AgentTodoRequestContext | null => {
		if (opts.publicBoard) {
			if (!opts.publicBoard.store) return null;
			return { store: opts.publicBoard.store, actorName: "public" };
		}
		return ctxOf(c);
	};

	async function groupsForProject(project: string | undefined): Promise<Set<string> | null> {
		if (!opts.projects) return null;
		const code = project?.trim();
		if (!code) {
			const projects = await opts.projects.listProjects();
			if (projects.length !== 1) return new Set();
			const only = projects[0];
			if (!only) return new Set();
			const groups = await opts.projects.listProjectGroups(only.code);
			return new Set(groups.map((group) => group.id));
		}
		try {
			const groups = await opts.projects.listProjectGroups(code);
			return new Set(groups.map((group) => group.id));
		} catch (err) {
			if (err instanceof Error && err.message.startsWith("project not found:")) return new Set();
			throw err;
		}
	}

	app.post("/api/auth/dashboard/sign-in", async (c) => {
		touch();
		if (!opts.machineDashboard) return c.text("not found", 404);
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "username and password are required" }, 400);
		}
		const username =
			body && typeof body === "object" && "username" in body
				? (body as { username: unknown }).username
				: undefined;
		const password =
			body && typeof body === "object" && "password" in body
				? (body as { password: unknown }).password
				: undefined;
		if (typeof username !== "string" || typeof password !== "string") {
			return c.json({ error: "username and password are required" }, 400);
		}
		const result = await opts.machineDashboard.signInDashboard(username, password);
		if (!result) return c.text("unauthorized", 401);
		setCookie(c, opts.machineDashboard.cookieName, result.sessionToken, {
			httpOnly: true,
			sameSite: "Lax",
			path: "/",
			maxAge: 30 * 24 * 60 * 60,
		});
		return c.json({ username: result.username, role: result.role });
	});

	app.post("/api/auth/dashboard/sign-out", async (c) => {
		touch();
		if (!opts.machineDashboard) return c.text("not found", 404);
		const sessionToken = getCookie(c, opts.machineDashboard.cookieName);
		await opts.machineDashboard.signOutDashboard(sessionToken);
		deleteCookie(c, opts.machineDashboard.cookieName, { path: "/" });
		return c.body(null, 204);
	});

	app.get("/api/auth/session", async (c) => {
		touch();
		if (!opts.machineDashboard) return c.text("not found", 404);
		const sessionToken = getCookie(c, opts.machineDashboard.cookieName);
		const user = await opts.machineDashboard.sessionUser(sessionToken);
		if (!user) return c.text("unauthorized", 401);
		return c.json(user);
	});

	app.get("/api/auth/mcp-token", async (c) => {
		touch();
		if (!opts.machineDashboard) return c.text("not found", 404);
		const ctx = c.get("agentTodo");
		if (!ctx) return c.text("unauthorized", 401);
		const token = opts.machineDashboard.mcpTokenForUser(ctx.actorName);
		if (!token) return c.text("unauthorized", 401);
		return c.json({ token });
	});

	app.post("/api/auth/password", async (c) => {
		touch();
		if (!opts.machineDashboard) return c.text("not found", 404);
		const ctx = c.get("agentTodo");
		if (!ctx) return c.text("unauthorized", 401);
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "currentPassword and newPassword are required" }, 400);
		}
		const currentPassword =
			body && typeof body === "object" && "currentPassword" in body
				? (body as { currentPassword: unknown }).currentPassword
				: undefined;
		const newPassword =
			body && typeof body === "object" && "newPassword" in body
				? (body as { newPassword: unknown }).newPassword
				: undefined;
		if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
			return c.json({ error: "currentPassword and newPassword are required" }, 400);
		}
		const ok = await opts.machineDashboard.changeOwnPassword(
			ctx.actorName,
			currentPassword,
			newPassword,
		);
		if (!ok) return c.text("unauthorized", 401);
		return c.body(null, 204);
	});

	app.post("/api/auth/sign-in", async (c) => {
		touch();
		if (!opts.machineSignIn) return c.text("not found", 404);
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "username and password are required" }, 400);
		}
		const username =
			body && typeof body === "object" && "username" in body
				? (body as { username: unknown }).username
				: undefined;
		const password =
			body && typeof body === "object" && "password" in body
				? (body as { password: unknown }).password
				: undefined;
		if (typeof username !== "string" || typeof password !== "string") {
			return c.json({ error: "username and password are required" }, 400);
		}
		const result = await opts.machineSignIn(username, password);
		if (!result) return c.text("unauthorized", 401);
		return c.json({ token: result.token });
	});

	app.get("/health", (c) => {
		touch();
		return c.json({ status: "ok", service: "agent-todo" });
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

	function emptyBoardPayload() {
		const columns: Record<string, unknown[]> = {};
		for (const status of TASK_STATUSES) columns[status] = [];
		return { rev: 0, groups: [] as { key: string; name: string }[], columns };
	}

	app.get("/api/events/stream", (c) => {
		touch();
		const stream = opts.publicBoard
			? createChangeStream(opts.changeHub, c.req.raw.signal, {
					projectPk: opts.publicBoard.projectPk,
				})
			: createChangeStream(opts.changeHub, c.req.raw.signal);
		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	});

	app.get("/api/projects", async (c) => {
		touch();
		if (opts.publicBoard) return c.json({ projects: listedPublicProjects(opts.publicBoard) });
		if (!opts.projects) return c.text("not found", 404);
		return c.json({ projects: await opts.projects.listProjects() });
	});

	app.post("/api/projects", async (c) => {
		touch();
		if (!opts.projects) return c.text("not found", 404);
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "path is required" }, 400);
		}
		const path =
			body && typeof body === "object" && "path" in body
				? (body as { path: unknown }).path
				: undefined;
		if (typeof path !== "string") return c.json({ error: "path is required" }, 400);
		try {
			return c.json(await registerDirectory(opts.projects, path));
		} catch (err) {
			if (err instanceof DirectoryRegistrationError) return c.json({ error: err.message }, 400);
			throw err;
		}
	});

	app.get("/api/groups", async (c) => {
		touch();
		const ctx = publicStoreOrRequestContext(c);
		if (!ctx) return c.json({ rev: 0, groups: [] });
		const payload = await listBoardGroups(ctx.store);
		if (ctx.groupAllowList?.length) {
			payload.groups = payload.groups.filter((g) => isGroupAllowed(ctx, g.key));
		}
		const scope = await groupsForProject(c.req.query("project"));
		if (scope) payload.groups = payload.groups.filter((group) => scope.has(group.key));
		return c.json(payload);
	});

	app.get("/api/board", async (c) => {
		touch();
		const ctx = publicStoreOrRequestContext(c);
		if (!ctx) return c.json(emptyBoardPayload());
		const payload = await buildBoardPayload(ctx.store, ctx);
		const scope = await groupsForProject(c.req.query("project"));
		if (scope) {
			payload.groups = payload.groups.filter((group) => scope.has(group.key));
			for (const status of Object.keys(payload.columns)) {
				payload.columns[status] = (payload.columns[status] ?? []).filter((task) => {
					if (!task || typeof task !== "object" || !("groupKey" in task)) return false;
					const groupKey = (task as { groupKey: unknown }).groupKey;
					return typeof groupKey === "string" && scope.has(groupKey);
				});
			}
		}
		return c.json(payload);
	});

	app.get("/api/groups/:groupKey/tasks/:taskId", async (c) => {
		touch();
		const ctx = publicStoreOrRequestContext(c);
		if (!ctx) return c.text("not found", 404);
		const groupKey = c.req.param("groupKey");
		const scope = await groupsForProject(c.req.query("project"));
		if (!isGroupAllowed(ctx, groupKey) || (scope && !scope.has(groupKey))) {
			return c.text("not found", 404);
		}
		const taskId = c.req.param("taskId");
		const task = await ctx.store.tasks.getById(taskId);
		if (!task || task.groupKey !== groupKey) return c.text("not found", 404);
		const comments = await ctx.store.comments.listByTask(taskId);
		return c.json(taskDrawerPayload(task, comments));
	});

	app.get("/api/groups/:groupKey/context", async (c) => {
		touch();
		const ctx = publicStoreOrRequestContext(c);
		if (!ctx) return c.text("not found", 404);
		const groupKey = c.req.param("groupKey");
		const scope = await groupsForProject(c.req.query("project"));
		if (!isGroupAllowed(ctx, groupKey) || (scope && !scope.has(groupKey))) {
			return c.text("not found", 404);
		}
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
		const requestCtx = ctxOf(c);
		const { toolsets, projectPk, groupAllowList } = requestCtx;
		const store = groupAllowList?.length
			? scopeStore(requestCtx.store, groupAllowList)
			: requestCtx.store;
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		const server = createMcpServer({
			store,
			toolsets,
			defaultAgent: requestCtx.actorName,
			defaultMaxTokens: opts.defaultMaxTokens,
			onToolCall: (name, startMs) => {
				observeTool(name, Date.now() - startMs);
			},
			resourceUpdates: opts.getMcpResourceUpdates,
			projectPk,
			machineProjects: opts.projects ? machineProjectTools(opts.projects) : undefined,
		});
		await server.connect(transport);
		return transport.handleRequest(c.req.raw);
	});

	if (opts.publicUrl) {
		mountOAuthMetadata(app, opts.publicUrl);
	}

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
