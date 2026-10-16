import { validateAgentIds } from "../integrations/registry.js";
import { normalizeServerBaseUrl } from "../machine/serverUrl.js";

export type InstallAgentSelection = {
	/** When set, wire only these agents (even if not detected). When omitted, wire detected agents only. */
	agentIds?: string[];
};

export type LocalInstallOptions = InstallAgentSelection & {
	mode: "local";
	loopback: boolean;
	serverUrl?: string;
};

export type ExternalInstallOptions = InstallAgentSelection & {
	mode: "external";
	url: string;
};

export type InstallOptions = LocalInstallOptions | ExternalInstallOptions;

export function parseInstallArgs(args: string[]): InstallOptions | { error: string } {
	let local = false;
	let loopback = false;
	let serverUrl: string | undefined;
	const agentIds: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--local") local = true;
		else if (arg === "--host") local = true;
		else if (arg === "--loopback") loopback = true;
		else if (arg === "--network") {
			local = true;
			loopback = false;
		} else if (arg === "--agent") {
			const id = args[i + 1];
			if (!id) {
				return { error: "agent-todo install: --agent requires an agent id" };
			}
			agentIds.push(id);
			i += 1;
		} else if (arg === "--url") {
			serverUrl = args[i + 1];
			i += 1;
		} else if (arg === "--remote") {
			return {
				error:
					"agent-todo install: --remote is removed; use --url <base> to connect to an external server",
			};
		} else if (arg === "--password" || arg === "--username") {
			return { error: `agent-todo install: ${arg} is no longer used` };
		} else {
			return { error: `agent-todo install: unknown option ${arg}` };
		}
	}

	if (local && serverUrl) {
		return { error: "agent-todo install: choose either --local or --url" };
	}
	if (loopback && !local) {
		return { error: "agent-todo install: --loopback requires --local" };
	}

	const uniqueAgentIds = [...new Set(agentIds)];
	const selection: InstallAgentSelection =
		uniqueAgentIds.length > 0 ? { agentIds: uniqueAgentIds } : {};

	const agentErr = selection.agentIds ? validateAgentIds(selection.agentIds) : undefined;
	if (agentErr) return { error: agentErr };

	if (serverUrl) {
		const normalized = normalizeServerBaseUrl(serverUrl);
		if (!normalized.ok) return { error: normalized.error };
		return { mode: "external", url: normalized.baseUrl, ...selection };
	}

	if (local) {
		return { mode: "local", loopback, serverUrl, ...selection };
	}

	return {
		error: "agent-todo install: pass --local or --url (or run without flags in a terminal)",
	};
}
