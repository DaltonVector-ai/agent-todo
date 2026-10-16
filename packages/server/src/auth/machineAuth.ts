import type { Database } from "bun:sqlite";
import type { Store } from "@agent-todo/core";
import type { AgentTodoRequestContext } from "../createApp.js";
import {
	createDashboardSession,
	DASHBOARD_SESSION_COOKIE,
	type DashboardSessionUser,
	deleteDashboardSession,
	findDashboardSessionUser,
} from "./daemonSessions.js";
import {
	findDaemonUserByBearer,
	findDaemonUserByUsername,
	openDaemonUsersDb,
	setDaemonUserPassword,
	signInDaemonUser,
} from "./daemonUsers.js";

export type MachineDashboardAuth = {
	cookieName: string;
	signInDashboard: (
		username: string,
		password: string,
	) => Promise<{
		sessionToken: string;
		username: string;
		role: DashboardSessionUser["role"];
	} | null>;
	resolveSession: (sessionToken: string | undefined) => Promise<AgentTodoRequestContext | null>;
	sessionUser: (
		sessionToken: string | undefined,
	) => Promise<{ username: string; role: DashboardSessionUser["role"] } | null>;
	signOutDashboard: (sessionToken: string | undefined) => Promise<void>;
	changeOwnPassword: (
		username: string,
		currentPassword: string,
		newPassword: string,
	) => Promise<boolean>;
	mcpTokenForUser: (username: string) => string | null;
};

export type MachineAuth = {
	db: Database;
	resolveBearer: (authHeader: string | undefined) => Promise<AgentTodoRequestContext | null>;
	signIn: (username: string, password: string) => Promise<{ token: string } | null>;
	dashboard: MachineDashboardAuth;
	close: () => void;
};

export function createMachineAuth(dbPath: string, store: Store, toolsets?: string[]): MachineAuth {
	const db = openDaemonUsersDb(dbPath);

	const resolveBearer = async (
		authHeader: string | undefined,
	): Promise<AgentTodoRequestContext | null> => {
		if (!authHeader?.startsWith("Bearer ")) return null;
		const bearer = authHeader.slice("Bearer ".length).trim();
		const user = findDaemonUserByBearer(db, bearer);
		if (!user) return null;
		return {
			store,
			toolsets,
			actorName: user.username,
		};
	};

	const resolveSession = async (
		sessionToken: string | undefined,
	): Promise<AgentTodoRequestContext | null> => {
		const user = findDashboardSessionUser(db, sessionToken);
		if (!user) return null;
		return {
			store,
			toolsets,
			actorName: user.username,
		};
	};

	const dashboard: MachineDashboardAuth = {
		cookieName: DASHBOARD_SESSION_COOKIE,
		resolveSession,
		sessionUser: async (sessionToken) => {
			const user = findDashboardSessionUser(db, sessionToken);
			if (!user) return null;
			return { username: user.username, role: user.role };
		},
		signInDashboard: async (username, password) => {
			const result = await signInDaemonUser(db, username, password);
			if (!result) return null;
			const row = findDaemonUserByUsername(db, result.username);
			if (!row) return null;
			const sessionToken = createDashboardSession(db, row.pk);
			return { sessionToken, username: result.username, role: result.role };
		},
		signOutDashboard: async (sessionToken) => {
			deleteDashboardSession(db, sessionToken);
		},
		changeOwnPassword: async (username, currentPassword, newPassword) => {
			const signedIn = await signInDaemonUser(db, username, currentPassword);
			if (!signedIn) return false;
			return await setDaemonUserPassword(db, username, newPassword);
		},
		mcpTokenForUser: (username) => findDaemonUserByUsername(db, username)?.mcp_token ?? null,
	};

	return {
		db,
		resolveBearer,
		signIn: async (username, password) => {
			const result = await signInDaemonUser(db, username, password);
			if (!result) return null;
			return { token: result.token };
		},
		dashboard,
		close: () => db.close(),
	};
}
