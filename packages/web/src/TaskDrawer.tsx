import { useEffect, useState } from "react";

type Props = {
	groupKey: string;
	taskId: string;
	onClose: () => void;
};

export function TaskDrawer({ groupKey, taskId, onClose }: Props) {
	const [data, setData] = useState<unknown>(null);

	useEffect(() => {
		void (async () => {
			const res = await fetch(
				`/api/groups/${encodeURIComponent(groupKey)}/tasks/${encodeURIComponent(taskId)}`,
			);
			setData(await res.json());
		})();
	}, [groupKey, taskId]);

	return (
		<aside
			style={{
				position: "fixed",
				top: 0,
				right: 0,
				width: "min(24rem, 100%)",
				height: "100%",
				background: "#111",
				color: "#eee",
				padding: "1rem",
				boxSizing: "border-box",
				overflow: "auto",
			}}
		>
			<button type="button" onClick={onClose}>
				Close
			</button>
			<pre style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem" }}>
				{JSON.stringify(data, null, 2)}
			</pre>
		</aside>
	);
}
