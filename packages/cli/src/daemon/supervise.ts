import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "../discover.js";
import { cleanupDaemonFiles, daemonPaths } from "./paths.js";

export type DaemonMeta = {
	pid: number;
	host: string;
	port: number;
	baseUrl: string;
	startedAt: string;
};

export function readDaemonMeta(project: ProjectConfig): DaemonMeta | null {
	const { metaFile, pidFile } = daemonPaths(project);
	if (!existsSync(metaFile)) return null;
	try {
		const meta = JSON.parse(readFileSync(metaFile, "utf8")) as DaemonMeta;
		if (!meta.baseUrl || !meta.port) return null;
		if (existsSync(pidFile)) {
			const pid = Number(readFileSync(pidFile, "utf8").trim());
			if (pid !== meta.pid) return null;
		}
		return meta;
	} catch {
		return null;
	}
}

export async function waitForDaemonReady(
	project: ProjectConfig,
	timeoutMs = 15_000,
): Promise<DaemonMeta> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const meta = readDaemonMeta(project);
		if (meta) {
			try {
				const res = await fetch(`${meta.baseUrl}/health`);
				if (res.ok) return meta;
			} catch {
				/* retry */
			}
		}
		await Bun.sleep(100);
	}
	throw new Error("daemon did not become ready in time");
}

export function spawnDaemon(project: ProjectConfig, cliEntry: string): void {
	const { pidFile, metaFile } = daemonPaths(project);
	const child = spawn(process.execPath, [cliEntry, "daemon", "--project", project.projectDir], {
		detached: true,
		stdio: "ignore",
		env: { ...process.env },
	});
	child.unref();
	writeFileSync(pidFile, String(child.pid), "utf8");
	// meta written by daemon process
	void metaFile;
}

export function resolveCliEntry(): string {
	return process.argv[1] ?? join(import.meta.dirname, "..", "index.ts");
}

export async function ensureDaemonRunning(project: ProjectConfig): Promise<DaemonMeta> {
	const existing = readDaemonMeta(project);
	if (existing) {
		try {
			const res = await fetch(`${existing.baseUrl}/health`);
			if (res.ok) return existing;
		} catch {
			/* stale */
		}
	}
	cleanupDaemonFiles(project);
	spawnDaemon(project, resolveCliEntry());
	return await waitForDaemonReady(project);
}
