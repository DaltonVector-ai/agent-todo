import { useEffect, useState } from "react";
import { fetchContext } from "./api.js";
import { IconDocument, IconKanban } from "./icons.js";
import { Markdown } from "./Markdown.js";
import { navigate } from "./routing.js";

type Props = {
	groupKey: string;
	projectCode: string | null;
	rev: number | null;
};

export function ContextPanel({ groupKey, projectCode, rev }: Props) {
	const [activeSlug, setActiveSlug] = useState<string | null>(null);
	const [data, setData] = useState<Awaited<ReturnType<typeof fetchContext>> | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void rev; // refetch when the board revision changes
		void (async () => {
			try {
				const json = await fetchContext(groupKey, projectCode);
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
	}, [groupKey, projectCode, rev]);

	const section = data?.sections.find((s) => s.slug === activeSlug);

	return (
		<div className="context-panel">
			<div className="group-tabs">
				<button
					type="button"
					onClick={() => navigate({ kind: "group", projectCode, groupKey, tab: "board" })}
				>
					<IconKanban />
					<span>Board</span>
				</button>
				<button type="button" className="active" disabled>
					<IconDocument />
					<span>Context</span>
				</button>
			</div>
			{error && <div className="context-error">{error}</div>}
			{data && (
				<div className="context-body">
					<nav className="context-toc">
						<div className="context-toc-header">
							<span>Outline</span>
							<span className="toc-count">{data.toc.length}</span>
						</div>
						<div className="context-toc-list">
							{data.toc.map((t) => (
								<button
									key={t.slug}
									type="button"
									className={t.slug === activeSlug ? "active" : ""}
									onClick={() => setActiveSlug(t.slug)}
								>
									<span className="toc-title">{t.title}</span>
									<span className="toc-tokens">{t.tokens}t</span>
								</button>
							))}
						</div>
					</nav>
					<article className="context-article">
						<h2 className="context-article-title">{section?.title}</h2>
						<div className="drawer-markdown">
							<Markdown source={section?.body ?? ""} />
						</div>
					</article>
				</div>
			)}
		</div>
	);
}
