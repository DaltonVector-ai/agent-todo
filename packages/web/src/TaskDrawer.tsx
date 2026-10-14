import { useCallback, useEffect, useState } from "react";
import { fetchTask, type TaskDetail } from "./api.js";
import { IconClock, IconClose, IconSparkles, IconTag, IconUser, IconWrench } from "./icons.js";
import { Markdown } from "./Markdown.js";
import { navigate } from "./routing.js";

type Props = {
	groupKey: string;
	projectCode: string | null;
	taskId: string;
	rev: number | null;
};

export function TaskDrawer({ groupKey, projectCode, taskId, rev }: Props) {
	const [task, setTask] = useState<TaskDetail | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void rev; // refetch when the board revision changes
		void (async () => {
			try {
				const next = await fetchTask(groupKey, taskId, projectCode);
				if (cancelled) return;
				setTask(next);
				setError(null);
			} catch {
				if (cancelled) return;
				setError("Task not found");
				setTask(null);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [groupKey, projectCode, taskId, rev]);

	const close = useCallback(
		() => navigate({ kind: "group", projectCode, groupKey, tab: "board" }),
		[groupKey, projectCode],
	);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [close]);

	return (
		<>
			<div className="drawer-backdrop" onClick={close} aria-hidden="true" />
			<aside className="task-drawer" role="dialog" aria-modal="true">
				<div className="drawer-header">
					<div className="drawer-header-left">
						{task && <span className="drawer-task-id">{task.id}</span>}
						{task && (
							<span className={`drawer-status status-pill status-${task.status}`}>
								<span className={`status-indicator status-${task.status}`} />
								{task.status}
							</span>
						)}
						{task && (
							<span className={`priority-badge priority-p${task.priority}`}>P{task.priority}</span>
						)}
					</div>
					<button
						type="button"
						className="drawer-close-btn"
						onClick={close}
						title="Close (Esc)"
						aria-label="Close"
					>
						<IconClose />
					</button>
				</div>

				<div className="drawer-content">
					{error && <div className="drawer-error">{error}</div>}

					{task && (
						<>
							<h2 className="drawer-title">{task.title}</h2>

							<div className="drawer-meta-grid">
								{task.assignee && (
									<div className="drawer-meta-item">
										<span className="drawer-meta-label">
											<IconUser /> Assignee
										</span>
										<span className="drawer-meta-value">{task.assignee}</span>
									</div>
								)}

								{task.claimOwner && (
									<div className="drawer-meta-item">
										<span className="drawer-meta-label">
											<IconUser /> Claim
										</span>
										<span className="drawer-meta-value">
											<strong>{task.claimOwner}</strong>
											{task.claimExpires && (
												<span className="meta-sub"> (expires {task.claimExpires})</span>
											)}
										</span>
									</div>
								)}

								{task.preferredModel && (
									<div className="drawer-meta-item">
										<span className="drawer-meta-label">
											<IconSparkles /> Model
										</span>
										<span className="drawer-meta-value mono">{task.preferredModel}</span>
									</div>
								)}

								{task.tags.length > 0 && (
									<div className="drawer-meta-item full-width">
										<span className="drawer-meta-label">
											<IconTag /> Tags
										</span>
										<div className="tag-chips">
											{task.tags.map((tag) => (
												<span key={tag} className="tag-chip">
													{tag}
												</span>
											))}
										</div>
									</div>
								)}

								{task.skills.length > 0 && (
									<div className="drawer-meta-item full-width">
										<span className="drawer-meta-label">
											<IconWrench /> Skills
										</span>
										<div className="chip-list">
											{task.skills.map((skill) => (
												<span key={skill} className="code-chip">
													{skill}
												</span>
											))}
										</div>
									</div>
								)}

								{task.mcps.length > 0 && (
									<div className="drawer-meta-item full-width">
										<span className="drawer-meta-label">
											<IconWrench /> MCPs
										</span>
										<div className="chip-list">
											{task.mcps.map((mcp) => (
												<span key={mcp} className="code-chip">
													{mcp}
												</span>
											))}
										</div>
									</div>
								)}
							</div>

							<div className="drawer-section">
								<h3 className="drawer-section-title">Description</h3>
								<div className="drawer-markdown">
									<Markdown source={task.description || "_No description._"} />
								</div>
							</div>

							<div className="drawer-times">
								<IconClock />
								<span>Created {task.createdAt}</span>
								<span>·</span>
								<span>Updated {task.updatedAt}</span>
							</div>

							<div className="drawer-section">
								<h3 className="drawer-section-title">Comments ({task.commentCount})</h3>
								{task.comments.length === 0 ? (
									<p className="empty-hint">No comments yet.</p>
								) : (
									<ul className="comment-list">
										{task.comments.map((c) => (
											<li key={c.id} className="comment-item">
												<div className="comment-header">
													<div className="comment-author-badge">
														{c.author.slice(0, 2).toUpperCase()}
													</div>
													<div className="comment-meta">
														<strong className="comment-author">{c.author}</strong>
														<span className="comment-kind">{c.kind}</span>
														<span className="comment-time">{c.createdAt}</span>
													</div>
													<span className="comment-id">{c.id}</span>
												</div>
												<div className="comment-body">{c.summary}</div>
											</li>
										))}
									</ul>
								)}
							</div>
						</>
					)}
				</div>
			</aside>
		</>
	);
}
