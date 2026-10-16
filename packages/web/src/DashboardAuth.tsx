import { type FormEvent, useState } from "react";
import type { DashboardSession } from "./api.js";
import { changeOwnPassword, dashboardSignIn, dashboardSignOut, fetchMcpToken } from "./api.js";

type SignInProps = {
	onSignedIn: (session: DashboardSession) => void;
};

export function DashboardSignIn({ onSignedIn }: SignInProps) {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const onSubmit = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const session = await dashboardSignIn(username.trim(), password);
			onSignedIn(session);
		} catch (e) {
			setError(
				e instanceof Error && e.message === "invalid_credentials"
					? "Wrong username or password."
					: "Sign-in failed.",
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="auth-screen">
			<div className="auth-card">
				<h2>Sign in</h2>
				<p className="auth-hint">Use your daemon account to open the board.</p>
				<form className="auth-form" onSubmit={onSubmit}>
					<label>
						<span>Username</span>
						<input
							type="text"
							name="username"
							autoComplete="username"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							required
						/>
					</label>
					<label>
						<span>Password</span>
						<input
							type="password"
							name="password"
							autoComplete="current-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
						/>
					</label>
					{error && <p className="auth-error">{error}</p>}
					<button type="submit" className="btn-primary" disabled={busy}>
						{busy ? "Signing in…" : "Sign in"}
					</button>
				</form>
			</div>
		</div>
	);
}

type AccountMenuProps = {
	session: DashboardSession;
	onSignedOut: () => void;
};

export function DashboardAccountMenu({ session, onSignedOut }: AccountMenuProps) {
	const [open, setOpen] = useState(false);
	const [mcpToken, setMcpToken] = useState<string | null>(null);
	const [tokenError, setTokenError] = useState<string | null>(null);
	const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");

	const revealToken = async () => {
		setTokenError(null);
		try {
			setMcpToken(await fetchMcpToken());
		} catch {
			setTokenError("Could not load MCP token.");
		}
	};

	const onSignOut = async () => {
		await dashboardSignOut();
		setOpen(false);
		onSignedOut();
	};

	const onChangePassword = async (event: FormEvent) => {
		event.preventDefault();
		setPasswordMessage(null);
		try {
			await changeOwnPassword(currentPassword, newPassword);
			setPasswordMessage("Password updated.");
			setCurrentPassword("");
			setNewPassword("");
		} catch (e) {
			setPasswordMessage(
				e instanceof Error && e.message === "invalid_password"
					? "Current password is wrong."
					: "Could not update password.",
			);
		}
	};

	return (
		<div className="account-menu">
			<button
				type="button"
				className="btn-secondary account-trigger"
				onClick={() => setOpen((v) => !v)}
			>
				<span>{session.username}</span>
			</button>
			{open && (
				<div className="account-panel">
					<p className="account-role">{session.role}</p>
					<button type="button" className="btn-secondary" onClick={() => void revealToken()}>
						Show MCP token
					</button>
					{mcpToken && <code className="mcp-token">{mcpToken}</code>}
					{tokenError && <p className="auth-error">{tokenError}</p>}
					<form className="auth-form compact" onSubmit={onChangePassword}>
						<p className="account-section-title">Change password</p>
						<label>
							<span>Current password</span>
							<input
								type="password"
								autoComplete="current-password"
								value={currentPassword}
								onChange={(e) => setCurrentPassword(e.target.value)}
								required
							/>
						</label>
						<label>
							<span>New password</span>
							<input
								type="password"
								autoComplete="new-password"
								value={newPassword}
								onChange={(e) => setNewPassword(e.target.value)}
								required
							/>
						</label>
						{passwordMessage && <p className="auth-hint">{passwordMessage}</p>}
						<button type="submit" className="btn-secondary">
							Update password
						</button>
					</form>
					<button type="button" className="btn-secondary" onClick={() => void onSignOut()}>
						Sign out
					</button>
				</div>
			)}
		</div>
	);
}
