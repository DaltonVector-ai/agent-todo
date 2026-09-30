import { describe, expect, test } from "bun:test";
import {
	allAllowedTransitions,
	isForbiddenWithoutForce,
	TASK_STATUSES,
	validateStatusTransition,
} from "./status.js";

const defaultCtx = {
	hasClaim: true,
	reopenCommentKind: "blocker" as const,
	depsMet: true,
	depsGateEnabled: true,
	terminalStatus: "deployed" as const,
};

describe("validateStatusTransition", () => {
	test("every documented allowed edge succeeds with default guards", () => {
		for (const { from, to } of allAllowedTransitions()) {
			const ctx = { ...defaultCtx };
			if (to !== "inprogress") ctx.hasClaim = false;
			if (to !== "reopen") ctx.reopenCommentKind = null;
			if (from === "verified" && to === "deploying") {
				ctx.terminalStatus = "deployed";
			}
			const result = validateStatusTransition(from, to, ctx);
			expect(result.ok).toBe(true);
		}
	});

	test("every non-allowed edge fails without force", () => {
		for (const from of TASK_STATUSES) {
			for (const to of TASK_STATUSES) {
				if (from === to) continue;
				if (!isForbiddenWithoutForce(from, to)) continue;
				const result = validateStatusTransition(from, to, {});
				expect(result.ok).toBe(false);
				if (!result.ok) {
					expect(result.code).toBe("FORCE_REQUIRED");
				}
			}
		}
	});

	test("non-allowed edge succeeds with force and reason", () => {
		const result = validateStatusTransition("todo", "deployed", {
			force: true,
			reason: "admin override",
		});
		expect(result.ok).toBe(true);
	});

	test("inprogress requires claim", () => {
		const result = validateStatusTransition("open", "inprogress", {
			hasClaim: false,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("CLAIM_REQUIRED");
	});

	test("reopen requires blocker or verification comment", () => {
		const result = validateStatusTransition("verifying", "reopen", {
			reopenCommentKind: "note",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("REOPEN_COMMENT_REQUIRED");
	});

	test("open blocked when deps unmet", () => {
		const result = validateStatusTransition("todo", "open", {
			depsGateEnabled: true,
			depsMet: false,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("DEPS_UNMET");
	});

	test("verified to deploying gated by terminal_status verified", () => {
		const blocked = validateStatusTransition("verified", "deploying", {
			terminalStatus: "verified",
			force: false,
		});
		expect(blocked.ok).toBe(false);
		if (!blocked.ok) expect(blocked.code).toBe("TERMINAL_STATUS_GATE");

		const forced = validateStatusTransition("verified", "deploying", {
			terminalStatus: "verified",
			force: true,
			reason: "ship anyway",
		});
		expect(forced.ok).toBe(true);
	});
});
