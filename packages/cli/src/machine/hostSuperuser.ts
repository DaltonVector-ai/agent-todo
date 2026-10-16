import { randomBytes } from "node:crypto";
import {
	countDaemonUsers,
	createDaemonUser,
	findDaemonUserByUsername,
	openDaemonUsersDb,
} from "@agent-todo/server";
import { openStore } from "@agent-todo/store-sqlite";

export type HostSuperuserResult = {
	username: string;
	token: string;
	/** Set when a new random password was generated for loopback install. */
	generatedPassword?: string;
};

function generateLoopbackPassword(): string {
	return randomBytes(18).toString("base64url");
}

/**
 * Ensures the machine database has superuser `admin` and returns that user's MCP token.
 * Creates `admin` with a generated password when the database has no users.
 */
export async function ensureHostSuperuser(
	dbPath: string,
	opts?: { password?: string },
): Promise<HostSuperuserResult> {
	const store = await openStore({ path: dbPath });
	await store.close();

	const db = openDaemonUsersDb(dbPath);
	try {
		if (countDaemonUsers(db) === 0) {
			const password = opts?.password?.trim() || generateLoopbackPassword();
			const generated = opts?.password?.trim() ? undefined : password;
			const { mcpToken } = await createDaemonUser(db, {
				username: "admin",
				password,
				role: "superuser",
			});
			return { username: "admin", token: mcpToken, generatedPassword: generated };
		}

		const admin = findDaemonUserByUsername(db, "admin");
		if (!admin) {
			throw new Error("agent-todo install: machine database has users but no admin superuser");
		}
		return { username: admin.username, token: admin.mcp_token };
	} finally {
		db.close();
	}
}
