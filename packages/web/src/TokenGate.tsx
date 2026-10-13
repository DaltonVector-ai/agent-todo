import { useState } from "react";
import { verifyToken } from "./api.js";
import { setBoardToken } from "./auth.js";

type Props = {
	onSuccess: () => void;
};

export function TokenGate({ onSuccess }: Props) {
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async () => {
		setBusy(true);
		setError(null);
		const ok = await verifyToken(value);
		setBusy(false);
		if (!ok) {
			setError("Invalid token. Check the value and try again.");
			return;
		}
		setBoardToken(value);
		onSuccess();
	};

	return (
		<div
			style={{
				maxWidth: "28rem",
				margin: "4rem auto",
				padding: "1.5rem",
				borderRadius: 8,
				background: "rgba(127,127,127,0.12)",
			}}
		>
			<h1 style={{ fontSize: "1.25rem", marginTop: 0 }}>agent-todo board</h1>
			<p style={{ opacity: 0.85 }}>
				Paste a Bearer API token to load groups and tasks. The token is stored in this tab only
				(sessionStorage).
			</p>
			<label style={{ display: "block", marginBottom: "0.5rem" }}>
				<span style={{ fontSize: "0.85rem" }}>API token</span>
				<input
					type="password"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					style={{ display: "block", width: "100%", marginTop: "0.25rem", padding: "0.5rem" }}
					autoComplete="off"
				/>
			</label>
			{error && <p style={{ color: "#e55" }}>{error}</p>}
			<button type="button" disabled={busy || !value.trim()} onClick={() => void submit()}>
				{busy ? "Checking…" : "Continue"}
			</button>
		</div>
	);
}
