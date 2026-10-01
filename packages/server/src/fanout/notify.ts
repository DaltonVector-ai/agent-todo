import type { Pool, PoolClient } from "pg";
import type { ContextCache } from "../cache/contextCache.js";
import type { ChangeHub } from "../changeHub.js";
import { notifyLagMs } from "../metrics.js";

export const NOTIFY_CHANNEL = "agent_todo_project";

export type FanoutPayload = {
	projectPk: string;
	groupKey?: string;
	rev?: number;
	emittedAt?: number;
};

export function encodeNotifyPayload(payload: FanoutPayload): string {
	return JSON.stringify(payload);
}

export function parseNotifyPayload(raw: string): FanoutPayload | null {
	try {
		const parsed = JSON.parse(raw) as FanoutPayload;
		if (!parsed?.projectPk) return null;
		return parsed;
	} catch {
		return null;
	}
}

/** NOTIFY primary after a successful write (call from store wrapper). */
export async function emitProjectNotify(pool: Pool, payload: FanoutPayload): Promise<void> {
	const body = encodeNotifyPayload({ ...payload, emittedAt: Date.now() });
	await pool.query(`SELECT pg_notify($1, $2)`, [NOTIFY_CHANNEL, body]);
}

export type McpResourceBump = (payload: FanoutPayload) => void;

export type StartNotifyRelayOptions = {
	pool: Pool;
	changeHub: ChangeHub;
	contextCache?: ContextCache;
	onMcpResourceUpdated?: McpResourceBump;
};

/**
 * LISTEN on NOTIFY_CHANNEL and fan out to SSE (ChangeHub), MCP resource hints, and context cache.
 */
export function startNotifyRelay(opts: StartNotifyRelayOptions): () => void {
	const client = opts.pool;
	let stopped = false;

	const run = async () => {
		const listenClient = await client.connect();
		await listenClient.query(`LISTEN ${NOTIFY_CHANNEL}`);
		listenClient.on("notification", (msg) => {
			if (!msg.payload) return;
			const receivedAt = Date.now();
			const payload = parseNotifyPayload(msg.payload);
			if (!payload) return;
			if (payload.emittedAt !== undefined) {
				notifyLagMs.observe(Math.max(0, receivedAt - payload.emittedAt));
			}
			opts.changeHub.bump(payload.groupKey);
			opts.contextCache?.invalidateProject(payload.projectPk, payload.groupKey);
			opts.onMcpResourceUpdated?.(payload);
		});
		listenClient.on("error", () => {
			if (!stopped) setTimeout(() => void run().catch(() => {}), 2000);
		});
		return listenClient;
	};

	let listenClient: PoolClient | undefined;
	void run()
		.then((c: PoolClient) => {
			listenClient = c;
		})
		.catch(() => {
			if (!stopped) setTimeout(() => void run().catch(() => {}), 2000);
		});

	return () => {
		stopped = true;
		listenClient?.release();
	};
}
