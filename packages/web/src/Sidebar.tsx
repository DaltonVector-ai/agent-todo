import type { GroupSummary } from "./api.js";
import type { AppRoute } from "./routing.js";
import { navigate } from "./routing.js";

type Props = {
	groups: GroupSummary[];
	route: AppRoute;
	narrow: boolean;
	projectCode: string | null;
};

function selectedKey(route: AppRoute): string | null {
	if (route.kind === "root" || route.kind === "all") return null;
	return route.groupKey;
}

export function Sidebar({ groups, route, narrow, projectCode }: Props) {
	const active = selectedKey(route);

	const pick = (key: string | null) => {
		if (key === null) {
			if (projectCode) navigate({ kind: "all", projectCode });
			else navigate({ kind: "root" });
			return;
		}
		navigate({ kind: "group", projectCode, groupKey: key, tab: "board" });
	};

	if (narrow) {
		return (
			<div className="group-picker">
				<label>
					Group
					<select
						value={active ?? ""}
						onChange={(e) => pick(e.target.value === "" ? null : e.target.value)}
					>
						<option value="">All groups</option>
						{groups.map((g) => (
							<option key={g.key} value={g.key}>
								{g.key} — {g.name} ({g.openTasks}/{g.totalTasks})
							</option>
						))}
					</select>
				</label>
			</div>
		);
	}

	return (
		<nav className="sidebar">
			<button
				type="button"
				className={
					route.kind === "all" || route.kind === "root" ? "sidebar-item active" : "sidebar-item"
				}
				onClick={() => pick(null)}
			>
				<strong>All groups</strong>
			</button>
			{groups.map((g) => (
				<button
					key={g.key}
					type="button"
					className={active === g.key ? "sidebar-item active" : "sidebar-item"}
					onClick={() => pick(g.key)}
				>
					<strong>{g.key}</strong>
					<span className="sidebar-sub">{g.name}</span>
					<span className="sidebar-count">
						{g.openTasks}/{g.totalTasks} open
					</span>
				</button>
			))}
		</nav>
	);
}
