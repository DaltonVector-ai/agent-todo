import { useCallback, useEffect, useRef, useState } from "react";
import {
	type BoardPayload,
	fetchBoard,
	fetchGroups,
	fetchProjects,
	type GroupSummary,
	type ProjectSummary,
} from "./api.js";
import { BoardColumns } from "./BoardColumns.js";
import { ContextPanel } from "./ContextPanel.js";
import { IconArrowRight, IconDocument, IconGrid, IconKanban, IconLogo } from "./icons.js";
import { chooseProject } from "./projectChoice.js";
import { type AppRoute, navigate, parsePath } from "./routing.js";
import { Sidebar } from "./Sidebar.js";
import { subscribeBoardChanges } from "./sse.js";
import { TaskDrawer } from "./TaskDrawer.js";
import "./App.css";

const PROJECT_STORAGE_KEY = "agent-todo.board.project";

type Catalog =
	| { kind: "loading" }
	| { kind: "legacy" }
	| { kind: "list"; projects: ProjectSummary[] }
	| { kind: "error" };

type AuthGate = "loading" | "open";

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

function readStoredProject(): string | null {
	try {
		return window.localStorage.getItem(PROJECT_STORAGE_KEY);
	} catch {
		return null;
	}
}

function writeStoredProject(code: string | null) {
	try {
		if (code) window.localStorage.setItem(PROJECT_STORAGE_KEY, code);
		else window.localStorage.removeItem(PROJECT_STORAGE_KEY);
	} catch {
		/* private mode and non-browser tests can refuse storage */
	}
}

function requestedCode(route: AppRoute): string | null {
	if (route.kind === "root") return null;
	return route.projectCode;
}

export function App() {
	const [route, setRoute] = useState<AppRoute>(() => parsePath(window.location.pathname));
	const [auth, setAuth] = useState<AuthGate>("loading");
	const [catalog, setCatalog] = useState<Catalog>({ kind: "loading" });
	const [groups, setGroups] = useState<GroupSummary[]>([]);
	const [board, setBoard] = useState<BoardPayload | null>(null);
	const [rev, setRev] = useState<number | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 720px)").matches);
	const boardRequest = useRef(0);

	const legacy = catalog.kind === "legacy";
	const selection =
		catalog.kind === "list"
			? chooseProject(catalog.projects, readStoredProject(), requestedCode(route))
			: null;
	const openCode = selection?.kind === "open" ? selection.code : null;
	const openProject =
		catalog.kind === "list" && openCode
			? catalog.projects.find((project) => project.code === openCode)
			: undefined;
	const showGroups = legacy || selection?.kind === "open";
	const navProject = legacy ? null : openCode;
	const boardQueryKey = legacy ? "legacy" : openCode ? `project:${openCode}` : "skip";

	const selectedGroupKey = route.kind === "root" || route.kind === "all" ? null : route.groupKey;

	const loadBoard = useCallback(async (projectCode: string | null) => {
		const request = ++boardRequest.current;
		try {
			const [g, b] = await Promise.all([fetchGroups(projectCode), fetchBoard(projectCode)]);
			if (boardRequest.current !== request) return;
			setGroups(g.groups);
			setBoard(b);
			setRev(b.rev);
			setLoadError(null);
		} catch (e) {
			if (boardRequest.current !== request) return;
			setLoadError(e instanceof Error ? e.message : "load failed");
		} finally {
			if (boardRequest.current === request) setLoaded(true);
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
		let cancelled = false;
		void (async () => {
			try {
				setAuth("open");
				const projects = await fetchProjects();
				if (cancelled) return;
				if (projects === null) setCatalog({ kind: "legacy" });
				else setCatalog({ kind: "list", projects });
			} catch (e) {
				if (cancelled) return;
				setLoadError(e instanceof Error ? e.message : "load failed");
				setCatalog({ kind: "error" });
				setAuth("open");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (catalog.kind !== "list") return;
		const stored = readStoredProject();
		if (stored && !catalog.projects.some((project) => project.code === stored)) {
			writeStoredProject(null);
		}
	}, [catalog]);

	useEffect(() => {
		if (catalog.kind !== "list" || route.kind !== "root") return;
		const choice = chooseProject(catalog.projects, readStoredProject(), null);
		if (choice.kind !== "open") return;
		writeStoredProject(choice.code);
		const next: AppRoute = { kind: "all", projectCode: choice.code };
		navigate(next);
		setRoute(next);
	}, [catalog, route]);

	useEffect(() => {
		if (catalog.kind !== "list") return;
		const code = requestedCode(route);
		if (code && catalog.projects.some((project) => project.code === code)) {
			writeStoredProject(code);
		}
	}, [catalog, route]);

	useEffect(() => {
		if (boardQueryKey === "skip") {
			boardRequest.current += 1;
			setGroups([]);
			setBoard(null);
			setRev(null);
			setLoaded(true);
			return;
		}
		const projectCode = boardQueryKey === "legacy" ? null : boardQueryKey.slice("project:".length);
		void loadBoard(projectCode);
	}, [boardQueryKey, loadBoard]);

	useEffect(() => {
		if (boardQueryKey === "skip") return;
		const projectCode = boardQueryKey === "legacy" ? null : boardQueryKey.slice("project:".length);
		return subscribeBoardChanges(() => void loadBoard(projectCode));
	}, [boardQueryKey, loadBoard]);

	const openProjectRoute = (code: string) => {
		writeStoredProject(code);
		const next: AppRoute = { kind: "all", projectCode: code };
		navigate(next);
		setRoute(next);
	};

	const showAllProjects = () => {
		writeStoredProject(null);
		navigate({ kind: "root" });
		setRoute({ kind: "root" });
	};

	const onOpenTask = (groupKey: string, taskId: string) => {
		const next: AppRoute = { kind: "task", projectCode: navProject, groupKey, taskId };
		navigate(next);
		setRoute(next);
	};

	const groupExists =
		!loaded || selectedGroupKey === null || groups.some((g) => g.key === selectedGroupKey);

	const columns = board ? filterBoard(board, selectedGroupKey) : {};
	const showGroupBadge = selectedGroupKey === null;
	const showBoard =
		showGroups &&
		(route.kind === "root" ||
			route.kind === "all" ||
			route.kind === "group" ||
			route.kind === "task") &&
		(groupExists || route.kind === "all" || route.kind === "root");

	if (auth === "loading") {
		return (
			<div className="auth-screen">
				<p className="auth-hint">Loading…</p>
			</div>
		);
	}

	return (
		<div className="app-shell">
			{showGroups && !narrow && (
				<Sidebar groups={groups} route={route} narrow={false} projectCode={navProject} />
			)}
			<main className="main-pane">
				{showGroups && narrow && (
					<Sidebar groups={groups} route={route} narrow={true} projectCode={navProject} />
				)}
				<header className="board-header">
					<div className="header-brand">
						<span className="brand-logo">
							<IconLogo />
						</span>
						<h1 className="board-title">agent-todo</h1>
						<span className="board-badge">board</span>
					</div>
					{openProject && (
						<div className="project-indicator">
							<span className="project-code-badge">{openProject.code}</span>
							<span className="project-name">{openProject.name}</span>
						</div>
					)}
					<div className="header-right">
						{catalog.kind === "list" &&
							catalog.projects.length > 1 &&
							selection?.kind === "open" && (
								<button type="button" className="btn-secondary" onClick={showAllProjects}>
									<IconGrid />
									<span>Projects</span>
								</button>
							)}
						{rev !== null && showGroups && (
							<div className="live-status" title={`Revision ${rev}`}>
								<span className="live-dot" />
								<span className="live-label">rev {rev}</span>
							</div>
						)}
					</div>
				</header>

				{loadError && <div className="board-alert error">{loadError}</div>}

				{selection?.kind === "empty" && (
					<div className="empty-state-card">
						<p className="empty-hint">
							No project is registered. The next step is to run init in a repository.
						</p>
					</div>
				)}

				{selection?.kind === "picker" && catalog.kind === "list" && (
					<div className="project-picker-wrapper">
						<div className="project-picker-heading">
							<h2>Select a project</h2>
							<p>Choose a workspace repository to view tasks and context</p>
						</div>
						<ul className="project-list">
							{catalog.projects.map((project) => (
								<li key={project.code}>
									<button
										type="button"
										className="project-choice"
										onClick={() => openProjectRoute(project.code)}
									>
										<div className="project-choice-content">
											<div className="project-choice-meta">
												<span className="project-code-badge">{project.code}</span>
												<strong className="project-name">{project.name}</strong>
											</div>
											<span className="sidebar-sub project-choice-path">{project.path}</span>
										</div>
										<IconArrowRight className="project-choice-arrow" />
									</button>
								</li>
							))}
						</ul>
					</div>
				)}

				{showGroups && loaded && groups.length === 0 && !loadError && (
					<div className="empty-state-card">
						<p className="empty-hint">No groups yet. Agents can create groups over MCP.</p>
					</div>
				)}

				{showGroups &&
					route.kind !== "all" &&
					route.kind !== "context" &&
					route.kind !== "root" &&
					selectedGroupKey &&
					groupExists && (
						<div className="group-tabs">
							<button
								type="button"
								className={route.kind === "group" || route.kind === "task" ? "active" : ""}
								onClick={() => {
									const next: AppRoute = {
										kind: "group",
										projectCode: navProject,
										groupKey: selectedGroupKey,
										tab: "board",
									};
									navigate(next);
									setRoute(next);
								}}
							>
								<IconKanban />
								<span>Board</span>
							</button>
							<button
								type="button"
								onClick={() => {
									const next: AppRoute = {
										kind: "context",
										projectCode: navProject,
										groupKey: selectedGroupKey,
									};
									navigate(next);
									setRoute(next);
								}}
							>
								<IconDocument />
								<span>Context</span>
							</button>
						</div>
					)}

				{showGroups && selectedGroupKey && !groupExists && (
					<div className="empty-state-card">
						<p className="empty-hint">Group “{selectedGroupKey}” was not found.</p>
					</div>
				)}

				{showBoard && (
					<BoardColumns columns={columns} showGroupBadge={showGroupBadge} onOpenTask={onOpenTask} />
				)}

				{showGroups && route.kind === "context" && groupExists && (
					<ContextPanel groupKey={route.groupKey} projectCode={navProject} rev={rev} />
				)}

				{showGroups && route.kind === "task" && groupExists && (
					<TaskDrawer
						groupKey={route.groupKey}
						projectCode={navProject}
						taskId={route.taskId}
						rev={rev}
					/>
				)}
			</main>
		</div>
	);
}
