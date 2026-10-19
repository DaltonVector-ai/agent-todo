import { existsSync } from "node:fs";
import { openStore } from "@agent-todo/store-sqlite";
import { isThisDaemon, readDaemonHealth } from "../daemon/health.js";
import { discoverProject } from "../discover.js";
import { collectDoctorChecks } from "../integrations/index.js";
import { ALL_INTEGRATIONS } from "../integrations/registry.js";
import { readMachineClient } from "../machine/client.js";
import { printDoctorHeader, printDoctorLine, printDoctorSection } from "../terminal/doctorPrint.js";

function agentLabel(id: string): string {
	return ALL_INTEGRATIONS.find((agent) => agent.id === id)?.label ?? id;
}

export async function runDoctor(): Promise<number> {
	let failed = false;
	printDoctorHeader();

	const binary = Bun.which("agent-todo");
	if (!binary) {
		failed ||= printDoctorLine(
			"Binary",
			"warn",
			"agent-todo not on PATH (ok when using bun run packages/cli/src/index.ts)",
		);
	} else {
		printDoctorLine("Binary", "ok", binary);
	}

	const client = readMachineClient();
	if (!client?.url) {
		failed ||= printDoctorLine(
			"Server",
			"warn",
			"no machine client config (run agent-todo install)",
		);
	} else {
		const health = await readDaemonHealth(client.url);
		if (isThisDaemon(health)) {
			printDoctorLine("Server", "ok", `${client.url} (agent-todo)`);
		} else {
			failed ||= printDoctorLine(
				"Server",
				"error",
				`${client.url} is not reachable or not agent-todo`,
			);
		}
	}

	const agentChecks = collectDoctorChecks();
	if (agentChecks.length > 0) {
		printDoctorSection("Agents");
		for (const check of agentChecks) {
			failed ||= printDoctorLine(agentLabel(check.agent), check.severity, check.message, {
				indent: 1,
			});
		}
	}

	const project = discoverProject();
	if (!project) {
		failed ||= printDoctorLine("Project", "warn", "no .agent-todo/config.toml discovered from cwd");
	} else {
		printDoctorLine("Project", "ok", project.configPath);
		if (project.mode === "local" && project.dbPath) {
			if (!existsSync(project.dbPath)) {
				failed ||= printDoctorLine(
					"Project",
					"warn",
					`repository database missing at ${project.dbPath}`,
					{ indent: 1 },
				);
			} else {
				try {
					const store = await openStore({ path: project.dbPath });
					await store.groups.list();
					printDoctorLine("Project", "ok", "repository database opens", { indent: 1 });
					await store.close();
				} catch (err) {
					failed ||= printDoctorLine(
						"Project",
						"warn",
						err instanceof Error ? err.message : String(err),
						{ indent: 1 },
					);
				}
			}
		}
	}

	console.log();
	return failed ? 1 : 0;
}
