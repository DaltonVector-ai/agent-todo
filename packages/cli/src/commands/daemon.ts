import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	ChangeHub,
	notifiableStore,
	startDaemonHttp,
	startMachineDaemon,
} from "@agent-todo/server";
import { openStore } from "@agent-todo/store-sqlite";
import { machineDaemonDbPath, machineDaemonPort } from "../daemon/endpoint.js";
import { cleanupDaemonFiles, daemonPaths } from "../daemon/paths.js";
import { discoverProject, type ProjectConfig } from "../discover.js";

export async function runMachineDaemon(
	opts: { dbPath?: string; port?: number } = {},
): Promise<number> {
	const dbPath = opts.dbPath ?? machineDaemonDbPath();
	const port = opts.port ?? machineDaemonPort();
	const runtime = await startMachineDaemon({ dbPath, port });
	const pidPath = join(dirname(dbPath), "daemon.pid");
	mkdirSync(dirname(pidPath), { recursive: true });
	writeFileSync(pidPath, `${process.pid}\n`, "utf8");
	console.error(`agent-todo daemon listening on ${runtime.baseUrl}`);

	const shutdown = async () => {
		await runtime.stop();
		rmSync(pidPath, { force: true });
	};

	process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
	process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

	await runtime.stopped;
	return 0;
}

export async function runDaemon(opts: { projectDir?: string } = {}): Promise<number> {
	const project = resolveProject(opts.projectDir);
	if (!project) {
		console.error("agent-todo daemon: no project found");
		return 1;
	}

	if (project.mode !== "daemon" && !process.env.AGENT_TODO_DAEMON_FORCE) {
		console.error(
			'agent-todo daemon: config mode must be "daemon" (or set AGENT_TODO_DAEMON_FORCE=1)',
		);
		return 1;
	}

	if (!existsSync(project.dbPath)) {
		console.error(`agent-todo daemon: database missing at ${project.dbPath}`);
		return 1;
	}

	const paths = daemonPaths(project);
	const hub = new ChangeHub();
	const base = await openStore({ path: project.dbPath });
	const store = notifiableStore(base, hub);

	writeFileSync(paths.pidFile, String(process.pid), "utf8");

	const runtime = await startDaemonHttp({
		store,
		changeHub: hub,
		toolsets: project.toolsets,
		defaultMaxTokens: project.defaultMaxTokens,
		metaPath: paths.metaFile,
		onListen: ({ port, host }) => {
			console.error(`agent-todo daemon listening on http://${host}:${port}`);
		},
	});

	const shutdown = async () => {
		await runtime.stop();
		await store.close();
		cleanupDaemonFiles(project);
	};

	process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
	process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

	await runtime.stopped;
	await store.close();
	cleanupDaemonFiles(project);
	return 0;
}

function resolveProject(projectDir?: string): ProjectConfig | null {
	if (projectDir) {
		const trimmed = projectDir.trim();
		process.env.AGENT_TODO_PROJECT = trimmed.endsWith(".agent-todo") ? trimmed : trimmed;
	}
	return discoverProject();
}
