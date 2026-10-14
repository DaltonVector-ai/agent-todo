import type { PostgresStore } from "@agent-todo/store-postgres";
import {
	defaultMigrationsDir,
	migrate,
	openPostgresClient,
	openStore,
} from "@agent-todo/store-postgres";
import { Pool } from "pg";
import { findApiToken } from "./auth/apiTokens.js";
import { authorizeBearer, parseLocalTokens } from "./auth/localTokens.js";
import { ContextCache } from "./cache/contextCache.js";
import { ChangeHub } from "./changeHub.js";
import { openCloudProjectStore } from "./cloudStore.js";
import { type AgentTodoRequestContext, createApp } from "./createApp.js";
import { startNotifyRelay } from "./fanout/notify.js";
import { COMPACTION_FLAGS_JOB_ID, runCompactionFlags } from "./jobs/compactionFlags.js";
import { RETENTION_JOB_ID, runRetention } from "./jobs/retention.js";
import { startJobRunner } from "./jobs/runner.js";
import { runClaimSweeper, SWEEP_CLAIMS_JOB_ID } from "./jobs/sweepClaims.js";
import { runTokenExpiry, TOKEN_EXPIRY_JOB_ID } from "./jobs/tokenExpiry.js";
import { pgPoolWaiting } from "./metrics.js";
import { initOtel } from "./otel.js";
import { parseReplicaUrls } from "./replicas.js";
import type { PushPayload } from "./sync/payload.js";
import { configuredPublicProjectRef, ensureConfiguredPublicProject } from "./tenancy.js";

function isAdminShutdown(err: unknown): boolean {
	return typeof err === "object" && err !== null && "code" in err && err.code === "57P01";
}

export type CloudServerRuntime = {
	app: ReturnType<typeof createApp>;
	port: number;
	baseUrl: string;
	pool: Pool;
	stop: () => Promise<void>;
};

export async function startCloudServer(opts?: {
	host?: string;
	port?: number;
	databaseUrl?: string;
	publicUrl?: string;
	jobsEnabled?: boolean;
}): Promise<CloudServerRuntime> {
	const databaseUrl = opts?.databaseUrl ?? process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error("DATABASE_URL is required for agent-todo server");
	const dbUrl = databaseUrl;

	const publicUrl = opts?.publicUrl ?? process.env.PUBLIC_URL ?? "http://127.0.0.1:8080";
	const host = opts?.host ?? process.env.HOST ?? "0.0.0.0";
	const port = opts?.port ?? Number(process.env.PORT ?? 8080);

	const replicaUrls = parseReplicaUrls(process.env.DATABASE_REPLICA_URLS);
	const replicaUrl = replicaUrls[0] ?? null;

	await initOtel();

	const pool = new Pool({ connectionString: dbUrl, max: 20 });
	pool.on("error", (err) => {
		if ("code" in err && err.code === "57P01") return;
		console.error(JSON.stringify({ level: "error", msg: "postgres pool error", err: String(err) }));
	});
	pool.on("connect", () => {
		pgPoolWaiting.set(pool.waitingCount);
	});

	const bootstrap = openPostgresClient(dbUrl);
	await migrate(
		bootstrap.db,
		async (stmt) => {
			await bootstrap.pool.query(stmt);
		},
		defaultMigrationsDir(),
	);
	await bootstrap.close();

	const publicProject = await ensureConfiguredPublicProject(pool);
	const localTokens = parseLocalTokens();
	const publicRef = configuredPublicProjectRef();
	if (publicProject && publicRef) {
		console.info(
			JSON.stringify({
				level: "info",
				msg: "public board project ready",
				project: `${publicRef.orgSlug}/${publicRef.projectSlug}`,
				note: "Web board is open; no bearer token is required",
			}),
		);
	}

	const storeCache = new Map<string, import("@agent-todo/core").Store>();
	const primaryStoreCache = new Map<string, PostgresStore>();
	const changeHub = new ChangeHub();
	const contextCache = new ContextCache();
	const mcpResourceUpdates: Array<{ projectPk: string; groupKey?: string }> = [];

	const stopNotify = startNotifyRelay({
		pool,
		changeHub,
		contextCache,
		onMcpResourceUpdated: (p) => {
			mcpResourceUpdates.push({ projectPk: p.projectPk, groupKey: p.groupKey });
			if (mcpResourceUpdates.length > 500) mcpResourceUpdates.shift();
		},
	});

	const jobsEnabled = opts?.jobsEnabled ?? process.env.JOBS_ENABLED !== "false";
	const stopJobs = startJobRunner({
		pool,
		enabled: jobsEnabled,
		jobs: [
			{
				id: SWEEP_CLAIMS_JOB_ID,
				name: "sweep_claims",
				run: (p) => runClaimSweeper(p, dbUrl),
			},
			{
				id: COMPACTION_FLAGS_JOB_ID,
				name: "compaction_flags",
				run: runCompactionFlags,
			},
			{ id: RETENTION_JOB_ID, name: "retention", run: runRetention },
			{ id: TOKEN_EXPIRY_JOB_ID, name: "token_expiry", run: runTokenExpiry },
		],
	});

	async function primaryForProject(projectPk: string): Promise<PostgresStore> {
		let primary = primaryStoreCache.get(projectPk);
		if (!primary) {
			primary = await openStore({ databaseUrl: dbUrl, projectPk });
			primaryStoreCache.set(projectPk, primary);
		}
		return primary;
	}

	async function storeForProject(projectPk: string) {
		let store = storeCache.get(projectPk);
		if (!store) {
			store = await openCloudProjectStore({
				databaseUrl: dbUrl,
				replicaUrl,
				projectPk,
				pool,
				changeHub,
			});
			storeCache.set(projectPk, store);
		}
		return store;
	}

	const resolveContext = async (
		authHeader: string | undefined,
	): Promise<AgentTodoRequestContext | null> => {
		if (!authHeader?.startsWith("Bearer ")) return null;
		const bearer = authHeader.slice("Bearer ".length).trim();
		const row = await findApiToken(pool, bearer);
		if (row) {
			const store = await storeForProject(row.project_pk);
			const toolsets =
				row.toolset_ceiling === "admin"
					? ["core", "plan", "admin"]
					: row.toolset_ceiling === "plan"
						? ["core", "plan"]
						: ["core"];
			return {
				store,
				toolsets,
				actorName: row.name,
				groupAllowList: row.groups ?? undefined,
				projectPk: row.project_pk,
				tokenPk: row.pk,
			};
		}
		if (publicProject && localTokens.length > 0) {
			const local = authorizeBearer(authHeader, localTokens);
			if (local.ok) {
				const store = await storeForProject(publicProject.projectPk);
				return {
					store,
					toolsets: ["core", "plan"],
					actorName: local.name,
					projectPk: publicProject.projectPk,
				};
			}
		}
		return null;
	};

	const app = createApp({
		changeHub,
		resolveContext,
		publicBoard: {
			store: publicProject ? await storeForProject(publicProject.projectPk) : null,
			projectPk: publicProject?.projectPk ?? null,
			project:
				publicProject && publicRef
					? {
							code: publicRef.projectSlug,
							name: publicRef.projectSlug,
							path: `${publicRef.orgSlug}/${publicRef.projectSlug}`,
						}
					: null,
		},
		readyCheck: async () => {
			const r = await pool.query("SELECT 1 as ok");
			return r.rows[0]?.ok === 1;
		},
		allowBrowserOrigin: (origin) => {
			if (!origin) return true;
			if (origin.startsWith("http://127.0.0.1:") || origin.startsWith("http://localhost:")) {
				return true;
			}
			try {
				const allowed = new URL(publicUrl);
				return origin === allowed.origin;
			} catch {
				return false;
			}
		},
		onPush: async (payload: PushPayload, ctx) => {
			if (!ctx.projectPk) throw new Error("push requires project context");
			const pg = await primaryForProject(ctx.projectPk);
			await pg.importPushPreserve(payload);
		},
		getMcpResourceUpdates: () => mcpResourceUpdates.slice(-20),
		publicUrl,
	});

	const bootstrapSecret = process.env.AGENT_TODO_BOOTSTRAP_SECRET?.trim();
	if (bootstrapSecret) {
		const { ensureProject, parseProjectRef, createProjectApiToken } = await import("./tenancy.js");
		app.post("/api/bootstrap", async (c) => {
			if (c.req.header("x-bootstrap-secret") !== bootstrapSecret) {
				return c.text("unauthorized", 401);
			}
			const body = (await c.req.json()) as { project: string; name?: string };
			const ref = parseProjectRef(body.project);
			if (!ref) return c.text("invalid project ref", 400);
			const ensured = await ensureProject(pool, ref, body.name ?? ref.projectSlug);
			const { token } = await createProjectApiToken(pool, ensured.projectPk, "init", "plan");
			return c.json({ token, project: body.project, projectPk: ensured.projectPk });
		});
	}

	const server = Bun.serve({ hostname: host, port, fetch: app.fetch });
	const actualPort = server.port ?? port;
	const baseUrl = `http://127.0.0.1:${actualPort}`;

	return {
		app,
		port: actualPort,
		baseUrl,
		pool,
		stop: async () => {
			await stopJobs();
			stopNotify();
			server.stop();
			for (const s of storeCache.values()) await s.close();
			for (const s of primaryStoreCache.values()) await s.close();
			try {
				await pool.end();
			} catch (err) {
				if (!isAdminShutdown(err)) throw err;
			}
		},
	};
}
