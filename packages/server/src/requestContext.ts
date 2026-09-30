import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContextState = {
	minRev?: number;
	requestId?: string;
	projectPk?: string;
	tokenPk?: string;
};

const storage = new AsyncLocalStorage<RequestContextState>();

export function runWithRequestContext<T>(state: RequestContextState, fn: () => T): T {
	return storage.run(state, fn);
}

export function getRequestMinRev(): number | undefined {
	return storage.getStore()?.minRev;
}

export function getRequestId(): string | undefined {
	return storage.getStore()?.requestId;
}

export function getTokenPk(): string | undefined {
	return storage.getStore()?.tokenPk;
}

export function getProjectPk(): string | undefined {
	return storage.getStore()?.projectPk;
}

export function parseMinRevHeader(header: string | undefined): number | undefined {
	if (!header?.trim()) return undefined;
	const n = Number(header);
	if (!Number.isFinite(n) || n < 0) return undefined;
	return Math.floor(n);
}
