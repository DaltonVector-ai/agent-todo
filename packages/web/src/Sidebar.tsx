import type { GroupSummary } from "./api.js";
import { IconChevronDown, IconFolder, IconLayers } from "./icons.js";
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
				<label className="group-picker-label">
					<span className="group-picker-title">Group</span>
					<div className="select-container">
						<select
							className="group-select"
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
						<IconChevronDown className="select-chevron" />
					</div>
				</label>
			</div>
		);
	}

	const totalOpen = groups.reduce((acc, g) => acc + g.openTasks, 0);
	const totalTasks = groups.reduce((acc, g) => acc + g.totalTasks, 0);

	return (
		<nav className="sidebar">
			<div className="sidebar-header">
				<span className="sidebar-section-title">Groups</span>
				<span className="sidebar-badge">{groups.length}</span>
			</div>
			<div className="sidebar-items">
				<button
					type="button"
					className={
						route.kind === "all" || route.kind === "root" ? "sidebar-item active" : "sidebar-item"
					}
					onClick={() => pick(null)}
				>
					<div className="sidebar-item-header">
						<span className="sidebar-icon">
							<IconLayers />
						</span>
						<strong className="sidebar-key">All groups</strong>
					</div>
					{groups.length > 0 && (
						<span className="sidebar-count">
							{totalOpen}/{totalTasks} open
						</span>
					)}
				</button>
				{groups.map((g) => (
					<button
						key={g.key}
						type="button"
						className={active === g.key ? "sidebar-item active" : "sidebar-item"}
						onClick={() => pick(g.key)}
					>
						<div className="sidebar-item-header">
							<span className="sidebar-icon">
								<IconFolder />
							</span>
							<strong className="sidebar-key">{g.key}</strong>
						</div>
						<span className="sidebar-sub" title={g.name}>
							{g.name}
						</span>
						<span className="sidebar-count">
							{g.openTasks}/{g.totalTasks} open
						</span>
					</button>
				))}
			</div>
		</nav>
	);
}
