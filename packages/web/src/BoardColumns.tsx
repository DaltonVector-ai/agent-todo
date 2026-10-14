import type { BoardTask } from "./api.js";
import { IconUser } from "./icons.js";

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

type Props = {
	columns: Record<string, BoardTask[]>;
	showGroupBadge: boolean;
	onOpenTask: (groupKey: string, taskId: string) => void;
};

function priorityLabel(p: number) {
	return `P${p}`;
}

export function BoardColumns({ columns, showGroupBadge, onOpenTask }: Props) {
	return (
		<div className="board-columns">
			{STATUSES.map((status) => {
				const tasks = columns[status] ?? [];
				return (
					<section key={status} className={`board-column column-${status}`}>
						<div className="board-column-header">
							<h2 className="board-column-title">
								<span className={`status-indicator status-${status}`} />
								<span className="column-name">{status}</span>
								<span className="column-count">({tasks.length})</span>
							</h2>
						</div>
						<div className="board-column-tasks">
							{tasks.length === 0 ? (
								<div className="column-empty">No tasks</div>
							) : (
								tasks.map((t) => (
									<button
										key={t.id}
										type="button"
										className="task-card"
										onClick={() => onOpenTask(t.groupKey, t.id)}
									>
										<div className="task-card-meta">
											<strong className="task-id">{t.id}</strong>
											<span className={`priority-badge priority-p${t.priority}`}>
												{priorityLabel(t.priority)}
											</span>
											{showGroupBadge && <span className="group-badge">{t.groupKey}</span>}
										</div>
										<div className="task-card-title">{t.title}</div>
										{t.claimOwner && (
											<div className="claim-line">
												<IconUser className="claim-icon" />
												<span>
													Claimed by <strong>{t.claimOwner}</strong>
												</span>
											</div>
										)}
									</button>
								))
							)}
						</div>
					</section>
				);
			})}
		</div>
	);
}

export { STATUSES };
