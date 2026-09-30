type CacheKey = string;

export type ContextCacheEntry = {
	body: string;
	tokens: number;
	version: number;
};

/** Per-node LRU-ish cache for context section bodies keyed by project:group:slug:v. */
export class ContextCache {
	private readonly maxEntries: number;
	private readonly map = new Map<CacheKey, ContextCacheEntry>();

	constructor(maxEntries = 500) {
		this.maxEntries = maxEntries;
	}

	private key(projectPk: string, groupKey: string, slug: string, version: number): CacheKey {
		return `${projectPk}:${groupKey}:${slug}:v${version}`;
	}

	get(
		projectPk: string,
		groupKey: string,
		slug: string,
		version: number,
	): ContextCacheEntry | undefined {
		return this.map.get(this.key(projectPk, groupKey, slug, version));
	}

	set(
		projectPk: string,
		groupKey: string,
		slug: string,
		version: number,
		entry: ContextCacheEntry,
	): void {
		const k = this.key(projectPk, groupKey, slug, version);
		if (this.map.size >= this.maxEntries && !this.map.has(k)) {
			const first = this.map.keys().next().value;
			if (first) this.map.delete(first);
		}
		this.map.set(k, entry);
	}

	invalidateProject(projectPk: string, groupKey?: string): void {
		const prefix = groupKey ? `${projectPk}:${groupKey}:` : `${projectPk}:`;
		for (const k of this.map.keys()) {
			if (k.startsWith(prefix)) this.map.delete(k);
		}
	}
}
