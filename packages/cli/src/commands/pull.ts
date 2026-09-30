import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPushPayload, exportProjectJsonl } from "@agent-todo/server";
import { openStore } from "@agent-todo/store-sqlite";
import { discoverProject } from "../discover.js";
import { getBearerForProject } from "../keychain.js";

function readRemoteUrl(configPath: string): string | undefined {
	const text = readFileSync(configPath, "utf8");
	const m = text.match(/\[remote\][\s\S]*?url\s*=\s*"([^"]+)"/);
	return m?.[1];
}

function readProjectRef(configPath: string): string | undefined {
	const text = readFileSync(configPath, "utf8");
	const m = text.match(/^project\s*=\s*"([^"]+)"/m);
	return m?.[1];
}

export async function runPull(opts?: { cwd?: string; out?: string }): Promise<number> {
	const cwd = opts?.cwd ?? process.cwd();
	const project = discoverProject(cwd);
	if (!project) {
		console.error("agent-todo: no .agent-todo/config.toml (run init first).");
		return 1;
	}

	if (project.mode === "remote") {
		const remoteUrl = readRemoteUrl(project.configPath);
		const projectRef = readProjectRef(project.configPath);
		if (!remoteUrl || !projectRef) {
			console.error("agent-todo: remote config incomplete.");
			return 1;
		}
		const bearer = getBearerForProject(remoteUrl, projectRef);
		if (!bearer) {
			console.error("agent-todo: no API token for pull.");
			return 1;
		}
		const res = await fetch(`${remoteUrl.replace(/\/$/, "")}/api/sync/export?format=jsonl`, {
			headers: { Authorization: `Bearer ${bearer}` },
		});
		if (!res.ok) {
			console.error(`pull failed: ${res.status}`);
			return 1;
		}
		const text = await res.text();
		const outPath = opts?.out ?? join(project.projectDir, "pull.jsonl");
		writeFileSync(outPath, text, "utf8");
		console.log(`wrote ${outPath}`);
		return 0;
	}

	const store = await openStore({ path: project.dbPath });
	try {
		const payload = await buildPushPayload(store);
		const body = await exportProjectJsonl(payload);
		const outPath = opts?.out ?? join(project.projectDir, "pull.jsonl");
		writeFileSync(outPath, body, "utf8");
		console.log(`wrote ${outPath}`);
		return 0;
	} finally {
		await store.close();
	}
}
