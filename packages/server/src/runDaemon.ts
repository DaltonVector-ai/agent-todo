import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Store, WorkService } from "@agent-todo/core";
import type { ChangeHub } from "./changeHub.js";
import { type CreateAppOptions, createApp } from "./createApp.js";

export type DaemonRuntime = {
	app: ReturnType<typeof createApp>;
	port: number;
	host: string;
	baseUrl: string;
	stop: () => Promise<void>;
	stopped: Promise<void>;
};

export type StartDaemonHttpOptions = CreateAppOptions & {
	host?: string;
	port?: number;
	metaPath?: string;
	onListen?: (info: { port: number; host: string }) => void;
	/**
	 * Idle shutdown used by the per-project daemon.
	 * `null` keeps the process up. Omit to use `idleTimeoutMs()`.
	 */
	idleMs?: number | null;
};

const DEFAULT_IDLE_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60_000;

export function idleTimeoutMs(): number {
	const raw = process.env.AGENT_TODO_DAEMON_IDLE_MS;
	if (raw) {
		const n = Number(raw);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return DEFAULT_IDLE_MS;
}

export async function startDaemonHttp(opts: StartDaemonHttpOptions): Promise<DaemonRuntime> {
	const host = opts.host ?? "127.0.0.1";
	const port = opts.port ?? 0;
	let lastActivity = Date.now();
	const touch = () => {
		lastActivity = Date.now();
		opts.onActivity?.();
	};
	const wrapped = createApp({ ...opts, onActivity: touch });

	const server = Bun.serve({
		hostname: host,
		port,
		fetch: wrapped.fetch,
	});

	const actualPort = server.port ?? port;
	const baseUrl = `http://${host}:${actualPort}`;

	if (opts.metaPath) {
		mkdirSync(dirname(opts.metaPath), { recursive: true });
		writeFileSync(
			opts.metaPath,
			`${JSON.stringify({ pid: process.pid, host, port: actualPort, baseUrl, startedAt: new Date().toISOString() }, null, 2)}\n`,
			"utf8",
		);
	}

	opts.onListen?.({ port: actualPort, host });

	const store = opts.store;
	if (!store) throw new Error("daemon requires a store");
	const work = new WorkService(store);
	const sweepTimer = setInterval(() => {
		void work.sweepExpiredClaims().catch(() => {});
	}, SWEEP_INTERVAL_MS);

	let stopping = false;
	let resolveStopped: () => void = () => {};
	const stopped = new Promise<void>((resolve) => {
		resolveStopped = resolve;
	});

	let idleTimer: ReturnType<typeof setInterval> | undefined;
	const stop = async () => {
		if (stopping) return;
		stopping = true;
		clearInterval(sweepTimer);
		if (idleTimer) clearInterval(idleTimer);
		await server.stop();
		resolveStopped();
	};

	const idleMs = opts.idleMs === undefined ? idleTimeoutMs() : opts.idleMs;
	if (idleMs !== null && idleMs > 0) {
		const pollMs = Math.min(5_000, Math.max(20, Math.floor(idleMs / 2)));
		idleTimer = setInterval(() => {
			if (Date.now() - lastActivity >= idleMs) {
				void stop();
			}
		}, pollMs);
	}

	return { app: wrapped, port: actualPort, host, baseUrl, stop, stopped };
}

export function createDaemonStack(
	store: Store,
	hub: ChangeHub,
	toolsets?: string[],
	defaultMaxTokens?: number,
) {
	return createApp({ store, changeHub: hub, toolsets, defaultMaxTokens });
}
