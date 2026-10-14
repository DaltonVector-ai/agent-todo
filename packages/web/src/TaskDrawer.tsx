import { useEffect, useState } from "react";
import { fetchTask, type TaskDetail } from "./api.js";
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

	const close = () => navigate({ kind: "group", projectCode, groupKey, tab: "board" });

	return (
		<aside className="task-drawer">
			<button type="button" onClick={close}>
				Close
			</button>
			{error && <p>{error}</p>}
			{task && (
				<>
					<h2>{task.id}</h2>
					<p className="drawer-status">
						{task.status} · P{task.priority}
					</p>
					<h3>{task.title}</h3>
					<div className="drawer-markdown">
						<Markdown source={task.description || "_No description._"} />
					</div>
					{task.tags.length > 0 && <p>Tags: {task.tags.join(", ")}</p>}
					{task.assignee && <p>Assignee: {task.assignee}</p>}
					{task.claimOwner && (
						<p>
							Claim: {task.claimOwner}
							{task.claimExpires ? ` until ${task.claimExpires}` : ""}
						</p>
					)}
					{task.preferredModel && <p>Model: {task.preferredModel}</p>}
					{task.skills.length > 0 && <p>Skills: {task.skills.join(", ")}</p>}
					{task.mcps.length > 0 && <p>MCPs: {task.mcps.join(", ")}</p>}
					<p className="drawer-times">
						Created {task.createdAt} · Updated {task.updatedAt}
					</p>
					<h4>Comments ({task.commentCount})</h4>
					<ul className="comment-list">
						{task.comments.map((c) => (
							<li key={c.id}>
								<strong>{c.id}</strong> [{c.kind}] {c.author}: {c.summary}
								<span className="comment-time"> {c.createdAt}</span>
							</li>
						))}
					</ul>
				</>
			)}
		</aside>
	);
}
