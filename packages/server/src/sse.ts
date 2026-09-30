import type { ChangeHub } from "./changeHub.js";

export function formatSseEvent(data: unknown, event = "change"): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createChangeStream(
	hub: ChangeHub,
	signal?: AbortSignal,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let lastRev = hub.currentRev();

	return new ReadableStream({
		start(controller) {
			const send = (payload: { rev: number; groupKey?: string }) => {
				controller.enqueue(encoder.encode(formatSseEvent(payload)));
			};

			send({ rev: lastRev });
			const unsubscribe = hub.subscribe((event) => {
				if (event.rev <= lastRev) return;
				lastRev = event.rev;
				send(event);
			});

			const onAbort = () => {
				unsubscribe();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			};
			signal?.addEventListener("abort", onAbort, { once: true });
		},
	});
}
