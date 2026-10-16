import { createDaemonUser, openDaemonUsersDb, setDaemonUserPassword } from "@agent-todo/server";
import { openStore } from "@agent-todo/store-sqlite";
import { machineDaemonDbPath } from "../daemon/endpoint.js";

function parseAccountsDbArgs(args: string[]): {
	dbPath: string;
	username: string;
	password: string | undefined;
} {
	let dbPath = machineDaemonDbPath();
	let username = "admin";
	let password: string | undefined;

	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--db") {
			const next = args[i + 1];
			if (next) {
				dbPath = next;
				i += 1;
			}
		} else if (arg === "--username") {
			const next = args[i + 1];
			if (next) {
				username = next;
				i += 1;
			}
		} else if (arg === "--password") {
			const next = args[i + 1];
			if (next) {
				password = next;
				i += 1;
			}
		}
	}

	return { dbPath, username, password };
}

export async function runAccountsCreateSuperuser(args: string[]): Promise<number> {
	const { dbPath, username, password } = parseAccountsDbArgs(args);

	if (!password?.trim()) {
		console.error("agent-todo accounts create-superuser: --password is required");
		return 1;
	}

	const store = await openStore({ path: dbPath });
	await store.close();

	const db = openDaemonUsersDb(dbPath);
	try {
		const { mcpToken } = await createDaemonUser(db, {
			username,
			password,
			role: "superuser",
		});
		console.log(`created superuser ${username}`);
		console.log(`mcp token: ${mcpToken}`);
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	} finally {
		db.close();
	}
}

export async function runAccountsSetPassword(args: string[]): Promise<number> {
	const { dbPath, username, password } = parseAccountsDbArgs(args);

	if (!password?.trim()) {
		console.error("agent-todo accounts set-password: --password is required");
		return 1;
	}

	const store = await openStore({ path: dbPath });
	await store.close();

	const db = openDaemonUsersDb(dbPath);
	try {
		const ok = await setDaemonUserPassword(db, username, password);
		if (!ok) {
			console.error(`agent-todo accounts set-password: user not found: ${username}`);
			return 1;
		}
		console.log(`password updated for ${username}`);
		return 0;
	} finally {
		db.close();
	}
}
