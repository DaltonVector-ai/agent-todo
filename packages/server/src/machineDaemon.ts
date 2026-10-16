import { homedir } from "node:os";
import { join } from "node:path";
import { openStore } from "@agent-todo/store-sqlite";
import { createMachineAuth } from "./auth/machineAuth.js";
import { ChangeHub } from "./changeHub.js";
import {
	MACHINE_LOOPBACK_HOST,
	readMachineListenHost,
} from "./machineListenConfig.js";
import { notifiableStore } from "./notifyStore.js";
import { type DaemonRuntime, startDaemonHttp } from "./runDaemon.js";

export const MACHINE_DAEMON_HOST = MACHINE_LOOPBACK_HOST;
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
	/** Overrides saved listen host (tests). */
	host?: string;
};

export type MachineDaemonRuntime = DaemonRuntime & {
	dbPath: string;
};

/**
 * Boot the always-on loopback daemon for the machine database.
 * Requires daemon accounts; no idle shutdown; no registered project required.
 */
export async function startMachineDaemon(
	opts: StartMachineDaemonOptions = {},
): Promise<MachineDaemonRuntime> {
	const dbPath = machineDatabasePath(opts.dbPath);
	const host = opts.host ?? readMachineListenHost();
	const port = opts.port ?? MACHINE_DAEMON_PORT;

	const base = await openStore({ path: dbPath });
	const hub = new ChangeHub();
	const store = notifiableStore(base, hub);
	const machineAuth = createMachineAuth(dbPath, store);

	const runtime = await startDaemonHttp({
		store,
		changeHub: hub,
		host,
		port,
		localTokens: [],
		idleMs: null,
		projects: base,
		resolveContext: machineAuth.resolveBearer,
		secureMachineBoard: true,
		machineSignIn: machineAuth.signIn,
		machineDashboard: machineAuth.dashboard,
	});

	let closed = false;
	const closeStore = async () => {
		if (closed) return;
		closed = true;
		machineAuth.close();
		await store.close();
	};

	const stop = async () => {
		await runtime.stop();
		await closeStore();
	};
	const stopped = runtime.stopped.then(() => closeStore());

	return { ...runtime, host, dbPath, stop, stopped };
}
