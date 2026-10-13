import type { BoardTask } from "./api.js";

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
			{STATUSES.map((status) => (
				<section key={status} className="board-column">
					<h2 className="board-column-title">
						{status} ({columns[status]?.length ?? 0})
					</h2>
					{(columns[status] ?? []).map((t) => (
						<button
							key={t.id}
							type="button"
							className="task-card"
							onClick={() => onOpenTask(t.groupKey, t.id)}
						>
							<div className="task-card-meta">
								<strong>{t.id}</strong>
								<span>{priorityLabel(t.priority)}</span>
								{showGroupBadge && <span className="group-badge">{t.groupKey}</span>}
							</div>
							<div>{t.title}</div>
							{t.claimOwner && <div className="claim-line">Claimed by {t.claimOwner}</div>}
						</button>
					))}
				</section>
			))}
		</div>
	);
}

export { STATUSES };
