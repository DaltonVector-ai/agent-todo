export type InstallOptions = {
	mode: "host-loopback";
	password?: string;
	username?: string;
	serverUrl?: string;
};

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
		return { error: "agent-todo install: remote install is not available yet" };
	}
	if (network) {
		return { error: "agent-todo install: network export is not available yet" };
	}

	return {
		mode: "host-loopback",
		password,
		username,
		serverUrl,
	};
}
