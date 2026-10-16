import { confirm, intro, isCancel, note, outro, select, text } from "@clack/prompts";
import { normalizeServerBaseUrl, verifyAgentTodoServer } from "../machine/serverUrl.js";
import type { InstallOptions } from "./installArgs.js";

export type PromptInstallResult =
	| { options: InstallOptions }
	| { error: string }
	| { cancelled: true };

function isInteractiveTerminal(): boolean {
	return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function probeDaemonUrl(baseUrl: string): Promise<boolean> {
	return await verifyAgentTodoServer(baseUrl);
}

export async function promptInstallOptions(): Promise<PromptInstallResult> {
	if (!isInteractiveTerminal()) {
		return { error: "agent-todo install: pass --local or --url (or run in a terminal)" };
	}

	intro("agent-todo install");

	const role = await select({
		message: "How should this machine use agent-todo?",
		options: [
			{
				value: "local" as const,
				label: "Start a new server",
				hint: "Run the SQLite daemon on this machine",
			},
			{
				value: "external" as const,
				label: "Connect to an external server",
				hint: "Point agents at a server that is already running",
			},
		],
	});
	if (isCancel(role)) {
		outro("Installation cancelled");
		return { cancelled: true };
	}

	let options: InstallOptions;

	if (role === "external") {
		const rawUrl = await text({
			message: "Server URL",
			placeholder: "http://192.168.1.20:8787",
			validate: (value) => {
				const normalized = normalizeServerBaseUrl(value);
				if (!normalized.ok) return normalized.error.replace(/^agent-todo install: /, "");
			},
		});
		if (isCancel(rawUrl)) {
			outro("Installation cancelled");
			return { cancelled: true };
		}
		const normalized = normalizeServerBaseUrl(rawUrl);
		if (!normalized.ok) return { error: normalized.error };
		const ok = await probeDaemonUrl(normalized.baseUrl);
		if (!ok) {
			return { error: `agent-todo install: ${normalized.baseUrl} is not an agent-todo server` };
		}
		options = { mode: "external", url: normalized.baseUrl };
	} else {
		const listen = await select({
			message: "Who can reach this server?",
			initialValue: "network" as const,
			options: [
				{
					value: "network" as const,
					label: "Local network (Recommended)",
					hint: "Anyone who can reach the port can read and write the board",
				},
				{
					value: "loopback" as const,
					label: "This machine only",
					hint: "Listen on 127.0.0.1",
				},
			],
		});
		if (isCancel(listen)) {
			outro("Installation cancelled");
			return { cancelled: true };
		}
		options = { mode: "local", loopback: listen === "loopback" };
	}

	const summary: string[] = [];
	if (options.mode === "external") {
		summary.push(`Connect to ${options.url}`);
		summary.push("MCP clients will point at that server with no credentials");
		summary.push("The local server will stop if this machine was hosting");
	} else {
		summary.push(
			options.loopback
				? "Start a server on this machine only (127.0.0.1)"
				: "Start a server on the local network (0.0.0.0)",
		);
		summary.push("MCP clients on this machine will use the loopback URL");
		summary.push("Login autostart will be registered");
	}
	note(summary.join("\n"), "Installation summary");

	const proceed = await confirm({ message: "Proceed with installation?" });
	if (isCancel(proceed) || !proceed) {
		outro("Installation cancelled");
		return { cancelled: true };
	}

	outro("Installing…");
	return { options };
}
