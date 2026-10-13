import { useEffect, useState } from "react";
import { fetchContext } from "./api.js";
import { Markdown } from "./Markdown.js";
import { navigate } from "./routing.js";

type Props = {
	groupKey: string;
	rev: number | null;
};

export function ContextPanel({ groupKey, rev }: Props) {
	const [activeSlug, setActiveSlug] = useState<string | null>(null);
	const [data, setData] = useState<Awaited<ReturnType<typeof fetchContext>> | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void rev; // refetch when the board revision changes
		void (async () => {
			try {
				const json = await fetchContext(groupKey);
				if (cancelled) return;
				setData(json);
				setActiveSlug((current) =>
					current && json.toc.some((t) => t.slug === current)
						? current
						: (json.toc[0]?.slug ?? null),
				);
				setError(null);
			} catch {
				if (cancelled) return;
				setError("Context not found");
				setData(null);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [groupKey, rev]);

	const section = data?.sections.find((s) => s.slug === activeSlug);

	return (
		<div className="context-panel">
			<div className="group-tabs">
				<button type="button" onClick={() => navigate({ kind: "group", groupKey, tab: "board" })}>
					Board
				</button>
				<button type="button" className="active" disabled>
					Context
				</button>
			</div>
			{error && <p>{error}</p>}
			{data && (
				<div className="context-body">
					<nav className="context-toc">
						{data.toc.map((t) => (
							<button
								key={t.slug}
								type="button"
								className={t.slug === activeSlug ? "active" : ""}
								onClick={() => setActiveSlug(t.slug)}
							>
								{t.title}
							</button>
						))}
					</nav>
					<article className="context-article">
						<h3>{section?.title}</h3>
						<div className="drawer-markdown">
							<Markdown source={section?.body ?? ""} />
						</div>
					</article>
				</div>
			)}
		</div>
	);
}
