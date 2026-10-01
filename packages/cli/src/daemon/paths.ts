import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "../discover.js";

export type DaemonPaths = {
	dir: string;
	pidFile: string;
	metaFile: string;
	socketPath: string;
};

export function daemonPaths(project: ProjectConfig): DaemonPaths {
	const dir = project.projectDir;
	return {
		dir,
		pidFile: join(dir, "daemon.pid"),
		metaFile: join(dir, "daemon.json"),
		socketPath: join(dir, process.platform === "win32" ? "daemon.pipe" : "daemon.sock"),
	};
}

export function cleanupDaemonFiles(project: ProjectConfig): void {
	const { pidFile, metaFile, socketPath } = daemonPaths(project);
	for (const f of [pidFile, metaFile, socketPath]) {
		try {
			if (existsSync(f)) unlinkSync(f);
		} catch {
			/* ignore */
		}
	}
}
