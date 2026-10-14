export type AppRoute =
	| { kind: "root" }
	| { kind: "all"; projectCode: string }
	| { kind: "group"; projectCode: string | null; groupKey: string; tab: "board" }
	| { kind: "context"; projectCode: string | null; groupKey: string }
	| { kind: "task"; projectCode: string | null; groupKey: string; taskId: string };

export function parsePath(pathname: string): AppRoute {
	const path = pathname.replace(/\/+$/, "") || "/";
	if (path === "/") return { kind: "root" };

	const project = /^\/p\/([^/]+)(?:\/g\/([^/]+)(?:\/(context|t\/([^/]+)))?)?$/.exec(path);
	if (project?.[1]) {
		const projectCode = decodeURIComponent(project[1]);
		if (!project[2]) return { kind: "all", projectCode };
		const groupKey = decodeURIComponent(project[2]);
		if (project[3] === "context") return { kind: "context", projectCode, groupKey };
		if (project[4]) {
			return { kind: "task", projectCode, groupKey, taskId: decodeURIComponent(project[4]) };
		}
		return { kind: "group", projectCode, groupKey, tab: "board" };
	}

	const legacy = /^\/g\/([^/]+)(?:\/(context|t\/([^/]+)))?$/.exec(path);
	if (!legacy?.[1]) return { kind: "root" };
	const groupKey = decodeURIComponent(legacy[1]);
	if (legacy[2] === "context") return { kind: "context", projectCode: null, groupKey };
	if (legacy[3]) {
		return { kind: "task", projectCode: null, groupKey, taskId: decodeURIComponent(legacy[3]) };
	}
	return { kind: "group", projectCode: null, groupKey, tab: "board" };
}

export function pathForRoute(route: AppRoute): string {
	switch (route.kind) {
		case "root":
			return "/";
		case "all":
			return `/p/${encodeURIComponent(route.projectCode)}`;
		case "group":
			return route.projectCode
				? `/p/${encodeURIComponent(route.projectCode)}/g/${encodeURIComponent(route.groupKey)}`
				: `/g/${encodeURIComponent(route.groupKey)}`;
		case "context":
			return route.projectCode
				? `/p/${encodeURIComponent(route.projectCode)}/g/${encodeURIComponent(route.groupKey)}/context`
				: `/g/${encodeURIComponent(route.groupKey)}/context`;
		case "task":
			return route.projectCode
				? `/p/${encodeURIComponent(route.projectCode)}/g/${encodeURIComponent(route.groupKey)}/t/${encodeURIComponent(route.taskId)}`
				: `/g/${encodeURIComponent(route.groupKey)}/t/${encodeURIComponent(route.taskId)}`;
	}
}

export function navigate(route: AppRoute) {
	const path = pathForRoute(route);
	if (window.location.pathname !== path) {
		window.history.pushState(null, "", path);
	}
	window.dispatchEvent(new PopStateEvent("popstate"));
}
