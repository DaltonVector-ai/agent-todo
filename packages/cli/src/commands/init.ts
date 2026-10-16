import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isThisDaemon, readDaemonHealth } from "../daemon/health.js";
import { machineDaemonBaseUrl } from "../daemon/endpoint.js";
import { readMachineClient } from "../machine/client.js";
import {
	readAgentsIdentityFile,
	readConfigIdentityFile,
	reconcileRepoIdentity,
	writeMachineProjectConfig,
} from "../project/identity.js";

const MARKER_START = "<!-- agent-todo:start -->";
const MARKER_END = "<!-- agent-todo:end -->";
export const ID_LINE =
	"Use the project code to list or create groups, the group id to list or create what is inside a group, and the task id alone to read or update one task.";

export type InitOptions = {
	yes: boolean;
	project?: string;
	cwd?: string;
	/** Overrides the saved machine client URL. */
	baseUrl?: string;
};

export async function runInit(opts: InitOptions): Promise<number> {
	const cwd = opts.cwd ?? process.cwd();
	const client = readMachineClient();
	if (!client?.url) {
		console.error("agent-todo: machine client config missing. Run `agent-todo install`.");
		return 1;
	}
	const baseUrl = machineDaemonBaseUrl(opts.baseUrl ?? client.url);
	if (!isThisDaemon(await readDaemonHealth(baseUrl))) {
		console.error("agent-todo: machine daemon is not running. Run `agent-todo install`.");
		return 1;
	}

	const reconciled = reconcileRepoIdentity(
		readAgentsIdentityFile(join(cwd, "AGENTS.md")),
		readConfigIdentityFile(join(cwd, ".agent-todo", "config.toml")),
	);
	if ("error" in reconciled) {
		console.error(reconciled.error);
		return 1;
	}

	let registration: { code: string; groupId: string };
	try {
		const body = reconciled.code ? { code: reconciled.code } : { path: cwd };
		const res = await fetch(`${baseUrl}/api/projects`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const text = await res.text();
			console.error(`agent-todo: init failed: ${res.status} ${text}`);
			return 1;
		}
		const payload = (await res.json()) as { code?: unknown; groupId?: unknown };
		if (typeof payload.code !== "string" || typeof payload.groupId !== "string") {
			console.error("agent-todo: daemon returned an unexpected project registration.");
			return 1;
		}
		registration = { code: payload.code, groupId: payload.groupId };
	} catch {
		console.error("agent-todo: machine daemon is not running. Run `agent-todo install`.");
		return 1;
	}

	writeMachineProjectConfig(cwd, {
		code: registration.code,
		defaultGroup: registration.groupId,
	});
	writeAgentsBlock(cwd, registration.code, registration.groupId);
	console.log(
		`Initialized agent-todo project ${registration.code} (group ${registration.groupId}).`,
	);
	return 0;
}

function writeAgentsBlock(cwd: string, code: string, groupId: string): void {
	const path = join(cwd, "AGENTS.md");
	const block = `${MARKER_START}
Project code: ${code}
Default group: ${groupId}
${ID_LINE}
${MARKER_END}`;
	if (!existsSync(path)) {
		writeFileSync(path, `${block}\n`, "utf8");
		return;
	}
	const text = readFileSync(path, "utf8");
	const start = text.indexOf(MARKER_START);
	const end = text.indexOf(MARKER_END);
	if (start >= 0 && end > start) {
		writeFileSync(
			path,
			`${text.slice(0, start)}${block}${text.slice(end + MARKER_END.length)}`,
			"utf8",
		);
		return;
	}
	const prefix = text.endsWith("\n") ? text : `${text}\n`;
	writeFileSync(path, `${prefix}\n${block}\n`, "utf8");
}
