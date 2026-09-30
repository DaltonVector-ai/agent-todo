export const TASK_STATUSES = [
	"todo",
	"open",
	"inprogress",
	"reopen",
	"verifying",
	"verified",
	"deploying",
	"deployed",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type TerminalStatus = "verified" | "deployed";

export type ReopenCommentKind = "blocker" | "verification";

export type TransitionErrorCode =
	| "INVALID_TRANSITION"
	| "CLAIM_REQUIRED"
	| "REOPEN_COMMENT_REQUIRED"
	| "DEPS_UNMET"
	| "TERMINAL_STATUS_GATE"
	| "FORCE_REQUIRED";

export type TransitionContext = {
	hasClaim?: boolean;
	reopenCommentKind?: ReopenCommentKind | null;
	terminalStatus?: TerminalStatus;
	depsMet?: boolean;
	depsGateEnabled?: boolean;
	force?: boolean;
	reason?: string;
};

const ALLOWED: ReadonlyMap<TaskStatus, readonly TaskStatus[]> = new Map([
	["todo", ["open"]],
	["open", ["inprogress", "todo"]],
	["reopen", ["inprogress", "todo"]],
	["inprogress", ["verifying", "open", "todo"]],
	["verifying", ["verified", "reopen"]],
	["verified", ["deploying", "reopen"]],
	["deploying", ["deployed", "reopen"]],
	["deployed", ["reopen"]],
]);

function isAllowedEdge(from: TaskStatus, to: TaskStatus): boolean {
	return ALLOWED.get(from)?.includes(to) ?? false;
}

export type TransitionResult =
	| { ok: true }
	| { ok: false; code: TransitionErrorCode; message: string };

export function validateStatusTransition(
	from: TaskStatus,
	to: TaskStatus,
	ctx: TransitionContext = {},
): TransitionResult {
	const allowed = isAllowedEdge(from, to);

	if (!allowed) {
		if (ctx.force && ctx.reason && ctx.reason.trim().length > 0) {
			return { ok: true };
		}
		return {
			ok: false,
			code: "FORCE_REQUIRED",
			message: `Transition ${from} → ${to} requires force and reason`,
		};
	}

	if (to === "open" && ctx.depsGateEnabled && ctx.depsMet === false) {
		return {
			ok: false,
			code: "DEPS_UNMET",
			message: "Cannot move to open while dependencies are unmet",
		};
	}

	if (to === "inprogress" && !ctx.hasClaim) {
		return {
			ok: false,
			code: "CLAIM_REQUIRED",
			message: "Entering inprogress requires an active claim",
		};
	}

	if (to === "reopen") {
		const kind = ctx.reopenCommentKind;
		if (kind !== "blocker" && kind !== "verification") {
			return {
				ok: false,
				code: "REOPEN_COMMENT_REQUIRED",
				message: "Entering reopen requires a blocker or verification comment",
			};
		}
	}

	if (
		from === "verified" &&
		to === "deploying" &&
		ctx.terminalStatus === "verified" &&
		!ctx.force
	) {
		return {
			ok: false,
			code: "TERMINAL_STATUS_GATE",
			message: "verified → deploying requires force when group terminal_status is verified",
		};
	}

	return { ok: true };
}

export function allAllowedTransitions(): Array<{ from: TaskStatus; to: TaskStatus }> {
	const pairs: Array<{ from: TaskStatus; to: TaskStatus }> = [];
	for (const from of TASK_STATUSES) {
		for (const to of ALLOWED.get(from) ?? []) {
			pairs.push({ from, to });
		}
	}
	return pairs;
}

export function isForbiddenWithoutForce(from: TaskStatus, to: TaskStatus): boolean {
	return !isAllowedEdge(from, to);
}
