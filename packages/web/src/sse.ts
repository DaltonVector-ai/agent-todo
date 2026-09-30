export function subscribeBoardChanges(onChange: () => void): () => void {
	const es = new EventSource("/api/events/stream");
	es.addEventListener("change", () => onChange());
	es.onerror = () => {
		es.close();
		setTimeout(() => subscribeBoardChanges(onChange), 1000);
	};
	return () => es.close();
}
