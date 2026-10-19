import { readFlowFileBody, writeMachineDaemonFlow } from "@agent-todo/server";
import { confirm, isCancel } from "@clack/prompts";
import { machineDaemonBaseUrl } from "../daemon/endpoint.js";
import { machineClientConfigPath, readMachineClient, writeMachineClient } from "./client.js";

export function isLocalDaemonUrl(
	clientUrl: string,
	loopbackBase = machineDaemonBaseUrl(),
): boolean {
	return clientUrl.replace(/\/$/, "") === loopbackBase.replace(/\/$/, "");
}

export async function resolveInstallFlowChoice(input: {
	noFlow?: boolean;
	interactive: boolean;
	clientPath?: string;
}): Promise<string | { error: string } | { cancelled: true }> {
	const path = input.clientPath ?? machineClientConfigPath();
	if (input.noFlow) return "off";
	const existing = readMachineClient(path);
	if (existing?.flow !== undefined) return existing.flow;
	if (!input.interactive) return "default";

	const follow = await confirm({
		message: "Follow the default planning flow?",
		initialValue: true,
	});
	if (isCancel(follow)) return { cancelled: true };
	return follow ? "default" : "off";
}

export function applyMachineFlowSelection(input: {
	flow: string;
	clientUrl: string;
	localServer: boolean;
	clientPath?: string;
	daemonConfigPath?: string;
}): void {
	const clientPath = input.clientPath ?? machineClientConfigPath();
	writeMachineClient({ url: input.clientUrl, flow: input.flow }, clientPath);
	if (input.localServer) {
		writeMachineDaemonFlow(input.flow, input.daemonConfigPath);
	}
}

export function setMachineFlowUse(
	slug: string,
	opts: { clientPath?: string; daemonConfigPath?: string; localServer: boolean },
): string | { error: string } {
	if (opts.localServer) {
		if (!readFlowFileBody(slug)) {
			return { error: `agent-todo flow: no flow file at ~/.agent-todo/flows/${slug}.md` };
		}
	}
	const clientUrl = readMachineClient(opts.clientPath)?.url;
	if (!clientUrl) return { error: "agent-todo flow: run install first" };
	applyMachineFlowSelection({
		flow: slug,
		clientUrl,
		localServer: opts.localServer,
		clientPath: opts.clientPath,
		daemonConfigPath: opts.daemonConfigPath,
	});
	return opts.clientPath ?? machineClientConfigPath();
}
