import { realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

export type ProjectListItem = {
	code: string;
	name: string;
	path: string;
};

export type ProjectRegistration = ProjectListItem & {
	groupId: string;
	created: boolean;
};

export type ProjectGroupItem = {
	id: string;
	name: string;
};

/** Machine-database registration used by the daemon route and a later init command. */
export type ProjectDirectoryRegistry = {
	registerProject(input: { path: string; name: string }): Promise<ProjectRegistration>;
	listProjects(): Promise<ProjectListItem[]>;
	listProjectGroups(projectCode: string): Promise<ProjectGroupItem[]>;
	createProjectGroup(input: { projectCode: string; name: string }): Promise<ProjectGroupItem>;
};

export class DirectoryRegistrationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DirectoryRegistrationError";
	}
}

/** Resolve two spellings of one directory to a single absolute path. */
export function canonicalProjectPath(directory: string): string {
	const trimmed = directory.trim();
	if (!trimmed) throw new DirectoryRegistrationError("path is required");
	let real: string;
	try {
		real = realpathSync(resolve(trimmed));
	} catch {
		throw new DirectoryRegistrationError(`directory not found: ${trimmed}`);
	}
	if (!statSync(real).isDirectory()) {
		throw new DirectoryRegistrationError(`not a directory: ${real}`);
	}
	return real;
}

export async function registerDirectory(
	registry: ProjectDirectoryRegistry,
	directory: string,
): Promise<ProjectRegistration> {
	const path = canonicalProjectPath(directory);
	const name = basename(path) || path;
	return await registry.registerProject({ path, name });
}
