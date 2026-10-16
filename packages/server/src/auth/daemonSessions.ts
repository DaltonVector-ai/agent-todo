import type { Database } from "bun:sqlite";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { hashApiToken } from "./apiTokens.js";
import type { DaemonUserRole } from "./daemonUsers.js";
import { findDaemonUserByUsername } from "./daemonUsers.js";

export const DASHBOARD_SESSION_COOKIE = "agent_todo_session";
export const DASHBOARD_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function newPk(): string {
	return randomBytes(8).toString("hex");
}

export function generateDashboardSessionToken(): string {
	return randomBytes(32).toString("base64url");
}

function sessionHashesMatch(storedHash: string, token: string): boolean {
	const a = Buffer.from(storedHash, "utf8");
	const b = Buffer.from(hashApiToken(token), "utf8");
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export function createDashboardSession(
	db: Database,
	userPk: string,
	ttlMs = DASHBOARD_SESSION_TTL_MS,
): string {
	const token = generateDashboardSessionToken();
	const pk = newPk();
	const now = Date.now();
	const createdAt = new Date(now).toISOString();
	const expiresAt = new Date(now + ttlMs).toISOString();
	db.query(
		`INSERT INTO daemon_sessions (pk, user_pk, session_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
	).run(pk, userPk, hashApiToken(token), expiresAt, createdAt);
	return token;
}

export type DashboardSessionUser = {
	username: string;
	role: DaemonUserRole;
	mcpToken: string;
};

export function findDashboardSessionUser(
	db: Database,
	token: string | undefined,
): DashboardSessionUser | null {
	if (!token?.trim()) return null;
	const hash = hashApiToken(token.trim());
	const row = db
		.query(
			`SELECT u.username, u.role, u.mcp_token, s.session_hash, s.expires_at
       FROM daemon_sessions s
       JOIN daemon_users u ON u.pk = s.user_pk
       WHERE s.session_hash = ?
       LIMIT 1`,
		)
		.get(hash) as {
		username: string;
		role: string;
		mcp_token: string;
		session_hash: string;
		expires_at: string;
	} | null;
	if (!row) return null;
	if (!sessionHashesMatch(row.session_hash, token.trim())) return null;
	if (Date.parse(row.expires_at) <= Date.now()) {
		deleteDashboardSession(db, token);
		return null;
	}
	return {
		username: row.username,
		role: row.role as DaemonUserRole,
		mcpToken: row.mcp_token,
	};
}

export function deleteDashboardSession(db: Database, token: string | undefined): void {
	if (!token?.trim()) return;
	const hash = hashApiToken(token.trim());
	db.query(`DELETE FROM daemon_sessions WHERE session_hash = ?`).run(hash);
}

export function findDaemonUserMcpToken(db: Database, username: string): string | null {
	const user = findDaemonUserByUsername(db, username);
	return user?.mcp_token ?? null;
}
