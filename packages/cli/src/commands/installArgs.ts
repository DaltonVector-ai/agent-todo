export type HostLoopbackInstallOptions = {
	mode: "host-loopback";
	password?: string;
	username?: string;
	serverUrl?: string;
};

export type HostNetworkInstallOptions = {
	mode: "host-network";
	password: string;
	username?: string;
	serverUrl?: string;
};

export type RemoteInstallOptions = {
	mode: "remote";
	url: string;
	username: string;
	password: string;
};

export type InstallOptions =
	| HostLoopbackInstallOptions
	| HostNetworkInstallOptions
	| RemoteInstallOptions;

export function parseInstallArgs(args: string[]): InstallOptions | { error: string } {
	let host = false;
	let remote = false;
	let loopback = false;
	let network = false;
	let password: string | undefined;
	let username: string | undefined;
	let serverUrl: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--host") host = true;
		else if (arg === "--remote") remote = true;
		else if (arg === "--loopback") loopback = true;
		else if (arg === "--network") network = true;
		else if (arg === "--password") {
			password = args[i + 1];
			i += 1;
		} else if (arg === "--username") {
			username = args[i + 1];
			i += 1;
		} else if (arg === "--url") {
			serverUrl = args[i + 1];
			i += 1;
		} else {
			return { error: `agent-todo install: unknown option ${arg}` };
		}
	}

	if (host && remote) {
		return { error: "agent-todo install: choose either --host or --remote" };
	}
	if (loopback && network) {
		return { error: "agent-todo install: choose either --loopback or --network" };
	}

	if (remote) {
		const url = serverUrl?.trim();
		const user = username?.trim();
		const pass = password?.trim();
		if (!url || !user || !pass) {
			return {
				error:
					"agent-todo install: remote install requires --url, --username, and --password",
			};
		}
		return { mode: "remote", url, username: user, password: pass };
	}

	if (network) {
		const pass = password?.trim();
		if (!pass) {
			return { error: "agent-todo install: --password is required for --network" };
		}
		return { mode: "host-network", password: pass, username, serverUrl };
	}

	return {
		mode: "host-loopback",
		password,
		username,
		serverUrl,
	};
}
