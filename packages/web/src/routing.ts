export type AppRoute =
	| { kind: "all" }
	| { kind: "group"; groupKey: string; tab: "board" }
	| { kind: "context"; groupKey: string }
	| { kind: "task"; groupKey: string; taskId: string };

export function parsePath(pathname: string): AppRoute {
	const path = pathname.replace(/\/+$/, "") || "/";
	if (path === "/") return { kind: "all" };

	const match = /^\/g\/([^/]+)(?:\/(context|t\/([^/]+)))?$/.exec(path);
	if (!match?.[1]) return { kind: "all" };
	const groupKey = decodeURIComponent(match[1]);
	if (match[2] === "context") return { kind: "context", groupKey };
	if (match[3]) return { kind: "task", groupKey, taskId: decodeURIComponent(match[3]) };
	return { kind: "group", groupKey, tab: "board" };
}

export function pathForRoute(route: AppRoute): string {
	switch (route.kind) {
		case "all":
			return "/";
		case "group":
			return `/g/${encodeURIComponent(route.groupKey)}`;
		case "context":
			return `/g/${encodeURIComponent(route.groupKey)}/context`;
		case "task":
			return `/g/${encodeURIComponent(route.groupKey)}/t/${encodeURIComponent(route.taskId)}`;
	}
}

export function navigate(route: AppRoute) {
	const path = pathForRoute(route);
	if (window.location.pathname !== path) {
		window.history.pushState(null, "", path);
	}
	window.dispatchEvent(new PopStateEvent("popstate"));
}
