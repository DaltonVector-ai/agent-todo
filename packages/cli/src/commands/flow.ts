import { machineClientConfigPath, readMachineClient } from "../machine/client.js";
import {
	applyMachineFlowSelection,
	isLocalDaemonUrl,
	setMachineFlowUse,
} from "../machine/flowSelection.js";

export async function runFlow(args: string[]): Promise<number> {
	const sub = args[0];
	if (!sub || sub === "-h" || sub === "--help") {
		console.log(`Usage:
  agent-todo flow default   Use the built-in planning flow
  agent-todo flow off       Turn the planning flow off
  agent-todo flow use <slug>  Use a custom flow from the server flows directory
`);
		return sub ? 0 : 1;
	}

	const client = readMachineClient();
	if (!client?.url) {
		console.error("agent-todo flow: run install first");
		return 1;
	}
	const localServer = isLocalDaemonUrl(client.url);
	const clientPath = machineClientConfigPath();

	if (sub === "default") {
		applyMachineFlowSelection({
			flow: "default",
			clientUrl: client.url,
			localServer,
		});
		console.log("flow: default");
		return 0;
	}
	if (sub === "off") {
		applyMachineFlowSelection({
			flow: "off",
			clientUrl: client.url,
			localServer,
		});
		console.log("flow: off");
		return 0;
	}
	if (sub === "use") {
		const slug = args[1]?.trim();
		if (!slug) {
			console.error("agent-todo flow use: pass a flow slug");
			return 1;
		}
		const result = setMachineFlowUse(slug, { localServer, clientPath });
		if (typeof result !== "string") {
			console.error(result.error);
			return 1;
		}
		console.log(`flow: ${slug}`);
		return 0;
	}

	console.error(`agent-todo flow: unknown subcommand ${sub}`);
	return 1;
}
