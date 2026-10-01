export type ShapedPayload = Record<string, unknown> | unknown[] | string | number | null;

export function toJsonString(payload: ShapedPayload): string {
	return JSON.stringify(payload);
}
