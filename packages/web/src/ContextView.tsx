import { useEffect, useState } from "react";

type Props = {
	groupKey: string;
	onClose: () => void;
};

export function ContextView({ groupKey, onClose }: Props) {
	const [data, setData] = useState<{
		toc: { slug: string; title: string }[];
		sections: { slug: string; title: string; body: string }[];
	} | null>(null);
	const [active, setActive] = useState<string | null>(null);

	useEffect(() => {
		void (async () => {
			const res = await fetch(`/api/groups/${encodeURIComponent(groupKey)}/context`);
			const json = await res.json();
			setData(json);
			setActive(json.toc[0]?.slug ?? null);
		})();
	}, [groupKey]);

	const section = data?.sections.find((s) => s.slug === active);

	return (
		<div
			style={{
				position: "fixed",
				bottom: 0,
				left: 0,
				right: 0,
				maxHeight: "40%",
				background: "#1a1a1a",
				color: "#eee",
				padding: "1rem",
				overflow: "auto",
			}}
		>
			<button type="button" onClick={onClose}>
				Close context
			</button>
			<div style={{ display: "flex", gap: "1rem" }}>
				<nav>
					{data?.toc.map((t) => (
						<button
							key={t.slug}
							type="button"
							onClick={() => setActive(t.slug)}
							style={{ display: "block" }}
						>
							{t.title}
						</button>
					))}
				</nav>
				<article style={{ flex: 1 }}>
					<h3>{section?.title}</h3>
					<pre style={{ whiteSpace: "pre-wrap" }}>{section?.body}</pre>
				</article>
			</div>
		</div>
	);
}
