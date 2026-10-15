export const PROJECT_CONTEXT_HINT =
	"project context is empty; inspect the repo and context_update overview*, commands*, conventions [code], architecture, testing [test], deploy [deploy], gotchas*, decisions";

export function emptyProjectContextHint(
	group: { key: string; projectCode: string | null } | null,
	sections: Array<{ body: string }>,
): string | undefined {
	if (!group?.projectCode) return undefined;
	if (group.key !== `${group.projectCode}-1`) return undefined;
	if (!sections.every((section) => section.body.trim().length === 0)) return undefined;
	return PROJECT_CONTEXT_HINT;
}
