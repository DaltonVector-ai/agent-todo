export type DefaultSectionSpec = {
	slug: string;
	title: string;
	alwaysInclude: boolean;
	appliesTo: string[];
};

export const DEFAULT_GROUP_SECTIONS: DefaultSectionSpec[] = [
	{ slug: "overview", title: "Overview", alwaysInclude: true, appliesTo: [] },
	{ slug: "commands", title: "Commands", alwaysInclude: true, appliesTo: [] },
	{ slug: "conventions", title: "Conventions", alwaysInclude: false, appliesTo: ["code"] },
	{ slug: "architecture", title: "Architecture", alwaysInclude: false, appliesTo: [] },
	{ slug: "testing", title: "Testing", alwaysInclude: false, appliesTo: ["test"] },
	{ slug: "deploy", title: "Deploy", alwaysInclude: false, appliesTo: ["deploy"] },
	{ slug: "gotchas", title: "Gotchas", alwaysInclude: true, appliesTo: [] },
	{ slug: "decisions", title: "Decisions", alwaysInclude: false, appliesTo: [] },
];
