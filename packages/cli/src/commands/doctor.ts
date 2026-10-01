import { existsSync } from "node:fs";
import { openStore } from "@agent-todo/store-sqlite";
import { discoverProject } from "../discover.js";
import { collectDoctorChecks } from "../integrations/index.js";

export async function runDoctor(): Promise<number> {
	let failed = false;

	const binary = Bun.which("agent-todo");
	if (!binary) {
		console.warn(
			"binary: warn — agent-todo not on PATH (ok when using bun run packages/cli/src/index.ts)",
		);
	} else {
		console.log(`binary: ok (${binary})`);
	}

	for (const check of collectDoctorChecks()) {
		const prefix = `${check.agent}: ${check.severity}`;
		if (check.severity === "error") {
			console.error(`${prefix} — ${check.message}`);
			failed = true;
		} else if (check.severity === "warn") {
			console.warn(`${prefix} — ${check.message}`);
		} else {
			console.log(`${prefix} — ${check.message}`);
		}
	}

	const project = discoverProject();
	if (!project) {
		console.warn("project: warn — no .agent-todo/config.toml discovered from cwd");
	} else {
		console.log(`project: ok — ${project.configPath} (mode=${project.mode})`);
		if (project.mode === "local") {
			if (!existsSync(project.dbPath)) {
				console.error(`project: error — database missing at ${project.dbPath}`);
				failed = true;
			} else {
				try {
					const store = await openStore({ path: project.dbPath });
					await store.groups.list();
					console.log("project: ok — database opens and lists groups");
					await store.close();
				} catch (err) {
					console.error(`project: error — ${err instanceof Error ? err.message : String(err)}`);
					failed = true;
				}
			}
		}
	}

	return failed ? 1 : 0;
}
