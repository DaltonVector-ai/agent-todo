import { normalizeServerBaseUrl } from "../machine/serverUrl.js";

export type LocalInstallOptions = {
	mode: "local";
	loopback: boolean;
	serverUrl?: string;
};

export type ExternalInstallOptions = {
	mode: "external";
	url: string;
};

export type InstallOptions = LocalInstallOptions | ExternalInstallOptions;

export function parseInstallArgs(args: string[]): InstallOptions | { error: string } {
	let local = false;
	let loopback = false;
	let serverUrl: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--local") local = true;
		else if (arg === "--host") local = true;
		else if (arg === "--loopback") loopback = true;
		else if (arg === "--network") {
			local = true;
			loopback = false;
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

	if (serverUrl) {
		const normalized = normalizeServerBaseUrl(serverUrl);
		if (!normalized.ok) return { error: normalized.error };
		return { mode: "external", url: normalized.baseUrl };
	}

	if (local) {
		return { mode: "local", loopback, serverUrl };
	}

	return {
		error: "agent-todo install: pass --local or --url (or run without flags in a terminal)",
	};
}
