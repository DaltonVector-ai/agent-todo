import type { ChangeHub } from "./changeHub.js";

export function formatSseEvent(data: unknown, event = "change"): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export type ChangeStreamOptions = {
	/**
	 * Restrict the stream to one project.
	 * `null` forwards no hub events (no public project configured).
	 * Omit the option to forward every event (daemon).
	 */
	projectPk?: string | null;
};

export function createChangeStream(
	hub: ChangeHub,
	signal?: AbortSignal,
	options?: ChangeStreamOptions,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let lastRev = hub.currentRev();
	const restricted = options !== undefined && "projectPk" in options;
	const onlyProjectPk = options?.projectPk ?? null;

	return new ReadableStream({
		start(controller) {
			const send = (payload: { rev: number; groupKey?: string }) => {
				const body = payload.groupKey ? payload : { rev: payload.rev };
				controller.enqueue(encoder.encode(formatSseEvent(body)));
			};

			send({ rev: lastRev });
			const unsubscribe = hub.subscribe((event) => {
				if (event.rev <= lastRev) return;
				if (restricted && (!onlyProjectPk || event.projectPk !== onlyProjectPk)) return;
				lastRev = event.rev;
				send({ rev: event.rev, groupKey: event.groupKey });
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
