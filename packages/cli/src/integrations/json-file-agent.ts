import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { backupBeforeInstall, restoreAfterUninstall } from "./backup.js";
import { hasMcpServer, mergeMcpServer, readJsonFile, writeJsonFile } from "./json-mcp.js";
import type { AgentIntegration, DoctorCheck } from "./types.js";

export function createJsonMcpIntegration(opts: {
	id: string;
	label: string;
	configPath: () => string;
	detect?: () => boolean;
}): AgentIntegration {
	const { id, label, configPath } = opts;
	return {
		id,
		label,
		detect() {
			if (opts.detect) return opts.detect();
			const path = configPath();
			return existsSync(dirname(path)) || existsSync(path);
		},
		install() {
			const path = configPath();
			const before = existsSync(path) ? readFileSync(path, "utf8") : null;
			backupBeforeInstall(id, path);
			const merged = mergeMcpServer(readJsonFile(path));
			writeJsonFile(path, merged);
			const after = existsSync(path) ? readFileSync(path, "utf8") : null;
			const changed = before !== after;
			return {
				changed,
				detail: changed ? `updated ${path}` : `${path} already wired`,
			};
		},
		uninstall() {
			const path = configPath();
			if (restoreAfterUninstall(id, path)) {
				return { changed: true, detail: `restored ${path} from install backup` };
			}
			return { changed: false, detail: `no install backup for ${label}` };
		},
		doctor() {
			const path = configPath();
			const checks: DoctorCheck[] = [];
			if (!existsSync(dirname(path)) && !existsSync(path)) {
				checks.push({
					agent: id,
					severity: "warn",
					message: `${label} config directory not found`,
				});
				return checks;
			}
			if (!existsSync(path)) {
				checks.push({
					agent: id,
					severity: "warn",
					message: `${label} MCP config missing (${path})`,
				});
				return checks;
			}
			if (hasMcpServer(readJsonFile(path))) {
				checks.push({ agent: id, severity: "ok", message: "agent-todo MCP entry present" });
			} else {
				checks.push({
					agent: id,
					severity: "error",
					message: `agent-todo MCP entry missing in ${path}`,
				});
			}
			return checks;
		},
	};
}
