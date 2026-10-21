import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

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
	registerProject(input: {
		path?: string;
		name?: string;
		code?: string;
	}): Promise<ProjectRegistration>;
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

/**
 * Normalize a client-sent project path: trim, require absolute, resolve `.` / `..`
 * without following symlinks, strip trailing slashes. The directory need not exist.
 */
export function normalizeRegistrationPath(directory: string): string {
	const trimmed = directory.trim();
	if (!trimmed) throw new DirectoryRegistrationError("path is required");
	if (!isAbsolute(trimmed)) {
		throw new DirectoryRegistrationError("path must be absolute");
	}
	let normalized = resolve(trimmed);
	if (normalized.length > 1) normalized = normalized.replace(/\/+$/, "");
	if (existsSync(normalized) && !statSync(normalized).isDirectory()) {
		throw new DirectoryRegistrationError(`not a directory: ${normalized}`);
	}
	return normalized;
}

/** @deprecated Use {@link normalizeRegistrationPath}. */
export function canonicalProjectPath(directory: string): string {
	return normalizeRegistrationPath(directory);
}

export async function registerDirectory(
	registry: ProjectDirectoryRegistry,
	directory: string,
	opts?: { code?: string },
): Promise<ProjectRegistration> {
	const code = opts?.code?.trim();
	if (code) {
		return await registry.registerProject({ code });
	}
	const path = normalizeRegistrationPath(directory);
	const name = basename(path) || path;
	return await registry.registerProject({ path, name });
}
