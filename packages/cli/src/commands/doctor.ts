import { existsSync } from "node:fs";
import { openStore } from "@agent-todo/store-sqlite";
import { discoverProject } from "../discover.js";
import { isThisDaemon, readDaemonHealth } from "../daemon/health.js";
import { collectDoctorChecks } from "../integrations/index.js";
import { readMachineClient } from "../machine/client.js";

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

	const client = readMachineClient();
	if (!client?.url) {
		console.warn("server: warn — no machine client config (run agent-todo install)");
	} else {
		const health = await readDaemonHealth(client.url);
		if (isThisDaemon(health)) {
			console.log(`server: ok — ${client.url} (agent-todo)`);
		} else {
			console.error(`server: error — ${client.url} is not reachable or not agent-todo`);
			failed = true;
		}
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
		console.log(`project: ok — ${project.configPath}`);
		if (project.mode === "local" && project.dbPath) {
			if (!existsSync(project.dbPath)) {
				console.warn(`project: warn — repository database missing at ${project.dbPath}`);
			} else {
				try {
					const store = await openStore({ path: project.dbPath });
					await store.groups.list();
					console.log("project: ok — repository database opens");
					await store.close();
				} catch (err) {
					console.warn(`project: warn — ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}
	}

	return failed ? 1 : 0;
}
