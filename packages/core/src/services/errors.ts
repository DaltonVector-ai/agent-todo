export type ServiceErrorCode =
	| "NOT_FOUND"
	| "VALIDATION"
	| "VERSION_CONFLICT"
	| "INVALID_TRANSITION"
	| "CLAIMED"
	| "DEPS_UNMET"
	| "BUDGET";

export type ServiceErrorDetails = Record<string, unknown>;

export class ServiceError extends Error {
	readonly code: ServiceErrorCode;
	readonly details?: ServiceErrorDetails;

	constructor(code: ServiceErrorCode, message: string, details?: ServiceErrorDetails) {
		super(message);
		this.name = "ServiceError";
		this.code = code;
		this.details = details;
	}
}

export function notFound(entity: string, id: string): ServiceError {
	return new ServiceError("NOT_FOUND", `${entity} not found: ${id}`, { id });
}

export function validation(message: string, details?: ServiceErrorDetails): ServiceError {
	return new ServiceError("VALIDATION", message, details);
}
