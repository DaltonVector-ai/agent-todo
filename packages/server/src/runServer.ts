import {
	defaultMigrationsDir,
	migrate,
	openPostgresClient,
	openStore,
	type PostgresStore,
} from "@agent-todo/store-postgres";
import { Pool } from "pg";
import { findApiToken } from "./auth/apiTokens.js";
import { ChangeHub } from "./changeHub.js";
import { type AgentTodoRequestContext, createApp } from "./createApp.js";
import { notifiableStore } from "./notifyStore.js";
import { mountOAuthMetadata } from "./oauth/metadata.js";
import type { PushPayload } from "./sync/payload.js";

export type CloudServerRuntime = {
	app: ReturnType<typeof createApp>;
	port: number;
	baseUrl: string;
	pool: Pool;
	stop: () => Promise<void>;
};

const writeBuckets = new Map<string, number[]>();

function rateLimitWrite(tokenKey: string): boolean {
	const now = Date.now();
	const windowMs = 1000;
	const max = 20;
	const hits = (writeBuckets.get(tokenKey) ?? []).filter((t) => now - t < windowMs);
	if (hits.length >= max) return false;
	hits.push(now);
	writeBuckets.set(tokenKey, hits);
	return true;
}

export async function startCloudServer(opts?: {
	host?: string;
	port?: number;
	databaseUrl?: string;
	publicUrl?: string;
}): Promise<CloudServerRuntime> {
	const databaseUrl = opts?.databaseUrl ?? process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error("DATABASE_URL is required for agent-todo server");
	const dbUrl = databaseUrl;

	const publicUrl = opts?.publicUrl ?? process.env.PUBLIC_URL ?? "http://127.0.0.1:8080";
	const host = opts?.host ?? process.env.HOST ?? "0.0.0.0";
	const port = opts?.port ?? Number(process.env.PORT ?? 8080);

	const pool = new Pool({ connectionString: dbUrl, max: 20 });
	const bootstrap = openPostgresClient(dbUrl);
	await migrate(
		bootstrap.db,
		async (stmt) => {
			await bootstrap.pool.query(stmt);
		},
		defaultMigrationsDir(),
	);
	await bootstrap.close();

	const storeCache = new Map<string, PostgresStore>();
	const changeHub = new ChangeHub();

	async function storeForProject(projectPk: string): Promise<PostgresStore> {
		let store = storeCache.get(projectPk);
		if (!store) {
			const opened = await openStore({ databaseUrl: dbUrl, projectPk });
			store = notifiableStore(opened, changeHub) as PostgresStore;
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
		if (!row) return null;
		if (!rateLimitWrite(row.hash)) return null;
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
		};
	};

	const app = createApp({
		changeHub,
		resolveContext,
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
			const pg = ctx.store as PostgresStore;
			await pg.importPushPreserve(payload);
		},
	});

	mountOAuthMetadata(app, publicUrl);

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
			server.stop();
			for (const s of storeCache.values()) await s.close();
			await pool.end();
		},
	};
}
