import { homedir } from "node:os";
import { join } from "node:path";
import { openStore } from "@agent-todo/store-sqlite";
import { ChangeHub } from "./changeHub.js";
import { notifiableStore } from "./notifyStore.js";
import { type DaemonRuntime, startDaemonHttp } from "./runDaemon.js";

export const MACHINE_DAEMON_HOST = "127.0.0.1";
export const MACHINE_DAEMON_PORT = 8787;

/** Single SQLite file for every local project. Tests pass an override. */
export function machineDatabasePath(override?: string): string {
	const trimmed = override?.trim();
	if (trimmed) return trimmed;
	return join(homedir(), ".agent-todo", "todo.db");
}

export type StartMachineDaemonOptions = {
	/** Overrides `~/.agent-todo/todo.db`. */
	dbPath?: string;
	/** Overrides port 8787. `0` asks the OS for an ephemeral port. */
	port?: number;
};

export type MachineDaemonRuntime = DaemonRuntime & {
	dbPath: string;
};

/**
 * Boot the always-on loopback daemon for the machine database.
 * No token, no idle shutdown, and no registered project required.
 */
export async function startMachineDaemon(
	opts: StartMachineDaemonOptions = {},
): Promise<MachineDaemonRuntime> {
	const dbPath = machineDatabasePath(opts.dbPath);
	const host = MACHINE_DAEMON_HOST;
	const port = opts.port ?? MACHINE_DAEMON_PORT;

	const base = await openStore({ path: dbPath });
	const hub = new ChangeHub();
	const store = notifiableStore(base, hub);

	const runtime = await startDaemonHttp({
		store,
		changeHub: hub,
		host,
		port,
		localTokens: [],
		idleMs: null,
		projects: base,
	});

	let closed = false;
	const closeStore = async () => {
		if (closed) return;
		closed = true;
		await store.close();
	};

	const stop = async () => {
		await runtime.stop();
		await closeStore();
	};
	const stopped = runtime.stopped.then(() => closeStore());

	return { ...runtime, host, dbPath, stop, stopped };
}
