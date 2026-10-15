const CONNECTION_LABELS = new Set(["localhost", "public"]);

export type ActorCandidates = {
	agent?: string | null;
	tokenName?: string | null;
	envAgent?: string | null;
	clientName?: string | null;
	processId?: number | null;
};

function present(value: string | null | undefined): string | undefined {
	if (typeof value !== "string") return undefined;
	if (value.trim().length === 0) return undefined;
	return value;
}

export function resolveActor(input: ActorCandidates): string {
	const explicit = present(input.agent);
	if (explicit !== undefined) return explicit;

	const token = present(input.tokenName);
	if (token !== undefined && !CONNECTION_LABELS.has(token.trim())) return token.trim();

	const envAgent = present(input.envAgent);
	if (envAgent !== undefined) return envAgent.trim();

	const clientName = present(input.clientName);
	if (clientName !== undefined && typeof input.processId === "number") {
		return `${clientName.trim().replace(/\s+/g, "-")}-${input.processId}`;
	}

	return "anonymous";
}
