import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { backupBeforeInstall, restoreAfterUninstall } from "./backup.js";
import { MCP_SERVER_ENTRY, MCP_SERVER_ID } from "./mcp-entry.js";
import { codexConfigPath } from "./paths.js";
import type { AgentIntegration, DoctorCheck } from "./types.js";

const SECTION_HEADER = `[mcp_servers.${MCP_SERVER_ID}]`;

function hasCodexEntry(text: string): boolean {
	if (!text.includes(SECTION_HEADER)) return false;
	return text.includes(`command = "${MCP_SERVER_ENTRY.command}"`);
}

function appendCodexSection(text: string): string {
	const block = [
		"",
		SECTION_HEADER,
		`command = "${MCP_SERVER_ENTRY.command}"`,
		`args = ${JSON.stringify([...MCP_SERVER_ENTRY.args])}`,
		"",
	].join("\n");
	const trimmed = text.replace(/\s+$/, "");
	return trimmed.length === 0 ? block.trimStart() : `${trimmed}${block}`;
}

export const codexIntegration: AgentIntegration = {
	id: "codex",
	label: "Codex CLI",
	detect() {
		const path = codexConfigPath();
		return existsSync(dirname(path)) || existsSync(path);
	},
	install() {
		const path = codexConfigPath();
		const before = existsSync(path) ? readFileSync(path, "utf8") : "";
		backupBeforeInstall("codex", path);
		let next = before;
		if (!hasCodexEntry(before)) {
			next = appendCodexSection(before);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, next.endsWith("\n") ? next : `${next}\n`, "utf8");
		}
		const changed = before !== next;
		return { changed, detail: changed ? `updated ${path}` : `${path} already wired` };
	},
	uninstall() {
		const path = codexConfigPath();
		if (restoreAfterUninstall("codex", path)) {
			return { changed: true, detail: `restored ${path} from install backup` };
		}
		return { changed: false, detail: "no install backup for Codex" };
	},
	doctor(): DoctorCheck[] {
		const path = codexConfigPath();
		if (!existsSync(path)) {
			return [
				{
					agent: "codex",
					severity: "warn",
					message: "Codex config missing (~/.codex/config.toml)",
				},
			];
		}
		const text = readFileSync(path, "utf8");
		if (hasCodexEntry(text)) {
			return [{ agent: "codex", severity: "ok", message: "agent-todo MCP entry present" }];
		}
		return [
			{
				agent: "codex",
				severity: "error",
				message: "agent-todo MCP entry missing in Codex config",
			},
		];
	},
};
