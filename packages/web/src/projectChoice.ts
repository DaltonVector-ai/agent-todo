export type ProjectChoice = { kind: "empty" } | { kind: "picker" } | { kind: "open"; code: string };

/**
 * Decide which project the board should open.
 * One registered project opens directly. Several projects stay on the picker
 * until a stored code is still in the list. A requested address that is no
 * longer registered returns to the picker.
 */
export function chooseProject(
	projects: readonly { code: string }[],
	storedCode: string | null,
	requestedCode: string | null = null,
): ProjectChoice {
	if (projects.length === 0) return { kind: "empty" };
	if (requestedCode) {
		if (projects.some((project) => project.code === requestedCode)) {
			return { kind: "open", code: requestedCode };
		}
		return { kind: "picker" };
	}
	if (projects.length === 1) {
		const only = projects[0];
		if (!only) return { kind: "empty" };
		return { kind: "open", code: only.code };
	}
	if (storedCode && projects.some((project) => project.code === storedCode)) {
		return { kind: "open", code: storedCode };
	}
	return { kind: "picker" };
}
