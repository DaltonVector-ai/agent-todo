export class QuotaExceededError extends Error {
	readonly code = "BUDGET" as const;
	readonly bucket: string;

	constructor(bucket: string, message: string) {
		super(message);
		this.name = "QuotaExceededError";
		this.bucket = bucket;
	}
}
