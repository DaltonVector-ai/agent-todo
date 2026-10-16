import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { machineMcpUrl } from "../daemon/endpoint.js";
import { backupBeforeInstall, restoreAfterUninstall } from "./backup.js";
import { installBearerToken } from "./install-context.js";
import { MCP_SERVER_ID } from "./mcp-entry.js";
import { codexConfigPath } from "./paths.js";
import type { AgentIntegration, DoctorCheck } from "./types.js";

const SECTION_HEADER = `[mcp_servers.${MCP_SERVER_ID}]`;

function escapeTomlString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function urlLine(): string {
	return `url = "${escapeTomlString(machineMcpUrl())}"`;
}

function headersLine(): string | null {
	const token = installBearerToken();
	if (!token) return null;
	return `http_headers = { Authorization = "Bearer ${escapeTomlString(token)}" }`;
}

function hasCodexEntry(text: string): boolean {
	if (!text.includes(SECTION_HEADER) || !text.includes(urlLine())) return false;
	const headers = headersLine();
	if (!headers) return !text.includes("http_headers");
	return text.includes(headers);
}

function withoutCodexSection(text: string): string {
	const start = text.indexOf(SECTION_HEADER);
	if (start < 0) return text;
	const next = text.indexOf("\n[", start + SECTION_HEADER.length);
	const end = next < 0 ? text.length : next;
	return `${text.slice(0, start)}${text.slice(end)}`;
}

function appendCodexSection(text: string): string {
	const lines = ["", SECTION_HEADER, urlLine()];
	const headers = headersLine();
	if (headers) lines.push(headers);
	lines.push("");
	const block = lines.join("\n");
	const trimmed = withoutCodexSection(text).replace(/\s+$/, "");
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
		const next = hasCodexEntry(before) ? before : appendCodexSection(before);
		if (next !== before) {
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
