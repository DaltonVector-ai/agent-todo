import { useCallback, useEffect, useState } from "react";
import { ContextView } from "./ContextView.js";
import { subscribeBoardChanges } from "./sse.js";
import { TaskDrawer } from "./TaskDrawer.js";

const STATUSES = [
	"todo",
	"open",
	"inprogress",
	"reopen",
	"verifying",
	"verified",
	"deploying",
	"deployed",
] as const;

type BoardTask = {
	id: string;
	groupKey: string;
	title: string;
	status: string;
};

type BoardPayload = {
	rev: number;
	groups: { key: string; name: string }[];
	columns: Record<string, BoardTask[]>;
};

export function App() {
	const [board, setBoard] = useState<BoardPayload | null>(null);
	const [selected, setSelected] = useState<{ groupKey: string; taskId: string } | null>(null);
	const [contextGroup, setContextGroup] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await fetch("/api/board");
		setBoard(await res.json());
	}, []);

	useEffect(() => {
		void load();
		return subscribeBoardChanges(() => void load());
	}, [load]);

	return (
		<div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
			<header style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
				<h1 style={{ margin: 0, fontSize: "1.25rem" }}>agent-todo board</h1>
				{board && <span style={{ opacity: 0.7 }}>rev {board.rev}</span>}
				{board?.groups.map((g) => (
					<button key={g.key} type="button" onClick={() => setContextGroup(g.key)}>
						Context {g.key}
					</button>
				))}
			</header>
			<div style={{ display: "flex", gap: "0.75rem", overflowX: "auto", marginTop: "1rem" }}>
				{STATUSES.map((status) => (
					<section
						key={status}
						style={{
							minWidth: "11rem",
							background: "rgba(127,127,127,0.15)",
							borderRadius: 8,
							padding: "0.5rem",
						}}
					>
						<h2 style={{ fontSize: "0.75rem", textTransform: "uppercase", margin: "0 0 0.5rem" }}>
							{status} ({board?.columns[status]?.length ?? 0})
						</h2>
						{(board?.columns[status] ?? []).map((t) => (
							<button
								key={t.id}
								type="button"
								onClick={() => setSelected({ groupKey: t.groupKey, taskId: t.id })}
								style={{
									display: "block",
									width: "100%",
									textAlign: "left",
									marginBottom: "0.5rem",
									padding: "0.5rem",
									borderRadius: 6,
									border: "none",
									background: "rgba(255,255,255,0.08)",
									cursor: "pointer",
								}}
							>
								<strong>{t.id}</strong>
								<div>{t.title}</div>
							</button>
						))}
					</section>
				))}
			</div>
			{selected && (
				<TaskDrawer
					groupKey={selected.groupKey}
					taskId={selected.taskId}
					onClose={() => setSelected(null)}
				/>
			)}
			{contextGroup && (
				<ContextView groupKey={contextGroup} onClose={() => setContextGroup(null)} />
			)}
		</div>
	);
}
