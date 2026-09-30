import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { integrationHome } from "./paths.js";

const MISSING_MARKER = "\0agent-todo:missing\0";

export function backupDir(): string {
	const base =
		process.env.AGENT_TODO_INTEGRATION_BACKUP_DIR ??
		join(integrationHome(), ".agent-todo", "integration-backups");
	return base;
}

/** Snapshot config before first install touch (enables byte-identical uninstall). */
export function backupBeforeInstall(agentId: string, configPath: string): void {
	const dir = backupDir();
	mkdirSync(dir, { recursive: true });
	const backupPath = join(dir, `${agentId}.bak`);
	if (existsSync(backupPath)) return;
	if (existsSync(configPath)) {
		copyFileSync(configPath, backupPath);
	} else {
		writeFileSync(backupPath, MISSING_MARKER, "utf8");
	}
}

export function restoreAfterUninstall(agentId: string, configPath: string): boolean {
	const backupPath = join(backupDir(), `${agentId}.bak`);
	if (!existsSync(backupPath)) return false;
	const marker = readFileSync(backupPath, "utf8");
	if (marker === MISSING_MARKER) {
		if (existsSync(configPath)) unlinkSync(configPath);
	} else {
		mkdirSync(dirname(configPath), { recursive: true });
		writeFileSync(configPath, marker, "utf8");
	}
	unlinkSync(backupPath);
	return true;
}
