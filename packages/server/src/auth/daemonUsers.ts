import { randomBytes } from "node:crypto";
import { Database } from "bun:sqlite";
import { hashApiToken, tokensMatch } from "./apiTokens.js";

export type DaemonUserRole = "superuser" | "member";

export type DaemonUserRow = {
	pk: string;
	username: string;
	password_hash: string;
	role: DaemonUserRole;
	token_hash: string;
	mcp_token: string;
};

export function generateMcpToken(): string {
	return `at_${randomBytes(24).toString("base64url")}`;
}

export async function hashPassword(password: string): Promise<string> {
	return await Bun.password.hash(password, { algorithm: "argon2id" });
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
	return await Bun.password.verify(password, passwordHash);
}

function newPk(): string {
	return randomBytes(8).toString("hex");
}

export function openDaemonUsersDb(dbPath: string): Database {
	const db = new Database(dbPath, { create: true });
	db.exec("PRAGMA foreign_keys = ON");
	return db;
}

export function countDaemonUsers(db: Database): number {
	const row = db.query("SELECT COUNT(*) AS n FROM daemon_users").get() as { n: number };
	return row.n;
}

export function findDaemonUserByUsername(db: Database, username: string): DaemonUserRow | null {
	const row = db
		.query(
			`SELECT pk, username, password_hash, role, token_hash, mcp_token
       FROM daemon_users WHERE username = ? COLLATE NOCASE LIMIT 1`,
		)
		.get(username.trim()) as DaemonUserRow | null;
	return row ?? null;
}

export function findDaemonUserByTokenHash(db: Database, tokenHash: string): DaemonUserRow | null {
	const row = db
		.query(
			`SELECT pk, username, password_hash, role, token_hash, mcp_token
       FROM daemon_users WHERE token_hash = ? LIMIT 1`,
		)
		.get(tokenHash) as DaemonUserRow | null;
	return row ?? null;
}

export async function createDaemonUser(
	db: Database,
	input: { username: string; password: string; role: DaemonUserRole },
): Promise<{ user: DaemonUserRow; mcpToken: string }> {
	const existing = findDaemonUserByUsername(db, input.username);
	if (existing) throw new Error(`user already exists: ${input.username}`);
	const pk = newPk();
	const now = new Date().toISOString();
	const mcpToken = generateMcpToken();
	const tokenHash = hashApiToken(mcpToken);
	const passwordHash = await hashPassword(input.password);
	db.query(
		`INSERT INTO daemon_users (pk, username, password_hash, role, token_hash, mcp_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(pk, input.username.trim(), passwordHash, input.role, tokenHash, mcpToken, now, now);
	const user = findDaemonUserByUsername(db, input.username);
	if (!user) throw new Error("failed to create user");
	return { user, mcpToken };
}

export async function signInDaemonUser(
	db: Database,
	username: string,
	password: string,
): Promise<{ token: string; username: string; role: DaemonUserRole } | null> {
	const user = findDaemonUserByUsername(db, username);
	if (!user) return null;
	if (!(await verifyPassword(password, user.password_hash))) return null;
	return { token: user.mcp_token, username: user.username, role: user.role as DaemonUserRole };
}

export function findDaemonUserByBearer(db: Database, bearer: string): DaemonUserRow | null {
	const hash = hashApiToken(bearer);
	const user = findDaemonUserByTokenHash(db, hash);
	if (!user) return null;
	if (!tokensMatch(user.token_hash, bearer)) return null;
	return user;
}

export async function setDaemonUserPassword(
	db: Database,
	username: string,
	password: string,
): Promise<boolean> {
	const user = findDaemonUserByUsername(db, username);
	if (!user) return false;
	const passwordHash = await hashPassword(password);
	const now = new Date().toISOString();
	db.query(`UPDATE daemon_users SET password_hash = ?, updated_at = ? WHERE pk = ?`).run(
		passwordHash,
		now,
		user.pk,
	);
	return true;
}
