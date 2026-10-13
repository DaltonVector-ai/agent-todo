import { useCallback, useEffect, useState } from "react";
import {
	ApiAuthError,
	type BoardPayload,
	fetchBoard,
	fetchGroups,
	type GroupSummary,
	probeBoardAccess,
} from "./api.js";
import { clearBoardToken, getBoardToken } from "./auth.js";
import { BoardColumns } from "./BoardColumns.js";
import { ContextPanel } from "./ContextPanel.js";
import { type AppRoute, navigate, parsePath } from "./routing.js";
import { Sidebar } from "./Sidebar.js";
import { subscribeBoardChanges } from "./sse.js";
import { TaskDrawer } from "./TaskDrawer.js";
import { TokenGate } from "./TokenGate.js";
import "./App.css";

function filterBoard(
	board: BoardPayload,
	groupKey: string | null,
): Record<string, import("./api.js").BoardTask[]> {
	if (!groupKey) return board.columns;
	const out: Record<string, import("./api.js").BoardTask[]> = {};
	for (const [status, tasks] of Object.entries(board.columns)) {
		out[status] = tasks.filter((t) => t.groupKey === groupKey);
	}
	return out;
}

export function App() {
	const [route, setRoute] = useState<AppRoute>(() => parsePath(window.location.pathname));
	const [groups, setGroups] = useState<GroupSummary[]>([]);
	const [board, setBoard] = useState<BoardPayload | null>(null);
	const [rev, setRev] = useState<number | null>(null);
	const [authRequired, setAuthRequired] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 720px)").matches);

	const selectedGroupKey = route.kind === "all" ? null : route.groupKey;

	const refresh = useCallback(async () => {
		try {
			const [g, b] = await Promise.all([fetchGroups(), fetchBoard()]);
			setGroups(g.groups);
			setBoard(b);
			setRev(b.rev);
			setAuthRequired(false);
			setLoadError(null);
		} catch (e) {
			if (e instanceof ApiAuthError) {
				setAuthRequired(true);
				return;
			}
			setLoadError(e instanceof Error ? e.message : "load failed");
		}
	}, []);

	useEffect(() => {
		const mq = window.matchMedia("(max-width: 720px)");
		const onMq = () => setNarrow(mq.matches);
		mq.addEventListener("change", onMq);
		return () => mq.removeEventListener("change", onMq);
	}, []);

	useEffect(() => {
		const onPop = () => setRoute(parsePath(window.location.pathname));
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	useEffect(() => {
		void (async () => {
			const probe = await probeBoardAccess();
			if (probe === "auth_required" && !getBoardToken()) {
				setAuthRequired(true);
				return;
			}
			await refresh();
		})();
	}, [refresh]);

	useEffect(() => {
		if (authRequired) return;
		return subscribeBoardChanges(() => void refresh());
	}, [authRequired, refresh]);

	const onOpenTask = (groupKey: string, taskId: string) => {
		navigate({ kind: "task", groupKey, taskId });
		setRoute({ kind: "task", groupKey, taskId });
	};

	if (authRequired) {
		return (
			<TokenGate
				onSuccess={() => {
					setAuthRequired(false);
					void refresh();
				}}
			/>
		);
	}

	const groupExists = selectedGroupKey === null || groups.some((g) => g.key === selectedGroupKey);

	const columns = board ? filterBoard(board, selectedGroupKey) : {};
	const showGroupBadge = selectedGroupKey === null;

	return (
		<div className="app-shell">
			{!narrow && <Sidebar groups={groups} route={route} narrow={false} />}
			<main className="main-pane">
				{narrow && <Sidebar groups={groups} route={route} narrow={true} />}
				<header className="board-header">
					<h1 style={{ margin: 0, fontSize: "1.25rem" }}>agent-todo board</h1>
					{rev !== null && <span style={{ opacity: 0.7 }}>rev {rev}</span>}
					{getBoardToken() && (
						<button
							type="button"
							onClick={() => {
								clearBoardToken();
								setAuthRequired(true);
							}}
						>
							Clear token
						</button>
					)}
				</header>

				{loadError && <p>{loadError}</p>}

				{groups.length === 0 && !loadError && (
					<p className="empty-hint">No groups yet. Agents can create groups over MCP.</p>
				)}

				{route.kind !== "all" && route.kind !== "context" && selectedGroupKey && groupExists && (
					<div className="group-tabs">
						<button
							type="button"
							className={route.kind === "group" || route.kind === "task" ? "active" : ""}
							onClick={() => {
								navigate({ kind: "group", groupKey: selectedGroupKey, tab: "board" });
								setRoute({ kind: "group", groupKey: selectedGroupKey, tab: "board" });
							}}
						>
							Board
						</button>
						<button
							type="button"
							onClick={() => {
								navigate({ kind: "context", groupKey: selectedGroupKey });
								setRoute({ kind: "context", groupKey: selectedGroupKey });
							}}
						>
							Context
						</button>
					</div>
				)}

				{selectedGroupKey && !groupExists && (
					<p className="empty-hint">Group “{selectedGroupKey}” was not found.</p>
				)}

				{(route.kind === "all" || route.kind === "group" || route.kind === "task") &&
					(groupExists || route.kind === "all") && (
						<BoardColumns
							columns={columns}
							showGroupBadge={showGroupBadge}
							onOpenTask={onOpenTask}
						/>
					)}

				{route.kind === "context" && groupExists && <ContextPanel groupKey={route.groupKey} />}

				{route.kind === "task" && groupExists && (
					<TaskDrawer groupKey={route.groupKey} taskId={route.taskId} />
				)}
			</main>
		</div>
	);
}
