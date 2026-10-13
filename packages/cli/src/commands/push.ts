import { readFileSync, writeFileSync } from "node:fs";
import { buildPushPayload } from "@agent-todo/server";
import { openStore } from "@agent-todo/store-sqlite";
import { discoverProject } from "../discover.js";
import { getBearerForProject } from "../keychain.js";

export type PushOptions = {
	remote?: string;
	project?: string;
	cwd?: string;
};

export async function runPush(opts: PushOptions): Promise<number> {
	const cwd = opts.cwd ?? process.cwd();
	const project = discoverProject(cwd);
	if (!project) {
		console.error("agent-todo: no .agent-todo/config.toml (run init first).");
		return 1;
	}
	if (project.mode === "remote") {
		console.error("agent-todo: already in remote mode.");
		return 1;
	}

	const remoteUrl = (opts.remote ?? readRemoteUrl(project.configPath) ?? "").replace(/\/$/, "");
	const projectRef = opts.project ?? readProjectRef(project.configPath);
	if (!remoteUrl || !projectRef) {
		console.error("usage: agent-todo push --remote <url> [--project org/slug]");
		return 1;
	}

	const bearer = getBearerForProject(remoteUrl, projectRef);
	if (!bearer) {
		console.error("agent-todo: no API token (run init --remote or set AGENT_TODO_REMOTE_TOKEN).");
		return 1;
	}

	const store = await openStore({ path: project.dbPath });
	try {
		const payload = await buildPushPayload(store);
		const res = await fetch(`${remoteUrl}/api/sync/push`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${bearer}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});
		if (!res.ok) {
			console.error(`push failed: ${res.status} ${await res.text()}`);
			return 1;
		}
	} finally {
		await store.close();
	}

	const configPath = project.configPath;
	let config = readFileSync(configPath, "utf8");
	config = config.replace(/mode\s*=\s*"[^"]+"/, 'mode = "remote"');
	if (!config.includes("[remote]")) {
		config += `\nproject = "${projectRef}"\n\n[remote]\nurl = "${remoteUrl}"\n`;
	} else {
		config = config.replace(/project\s*=\s*"[^"]+"/, `project = "${projectRef}"`);
		config = config.replace(/url\s*=\s*"[^"]+"/, `url = "${remoteUrl}"`);
	}
	writeFileSync(configPath, config, "utf8");
	console.log(`Pushed to ${remoteUrl} (${projectRef}) and switched to remote mode.`);
	return 0;
}

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

export function parsePushArgs(args: string[]): PushOptions {
	let remote: string | undefined;
	let project: string | undefined;
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--remote") {
			remote = args[i + 1];
			i += 1;
		} else if (arg === "--project") {
			project = args[i + 1];
			i += 1;
		}
	}
	return { remote, project };
}
