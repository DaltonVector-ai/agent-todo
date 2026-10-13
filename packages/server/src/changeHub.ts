export type ChangeEvent = {
	rev: number;
	groupKey?: string;
	projectPk?: string;
};

type Listener = (event: ChangeEvent) => void;

export class ChangeHub {
	private rev = 0;
	private readonly listeners = new Set<Listener>();

	bump(groupKey?: string, projectPk?: string): ChangeEvent {
		this.rev += 1;
		const event: ChangeEvent = { rev: this.rev, groupKey, projectPk };
		for (const listener of this.listeners) {
			listener(event);
		}
		return event;
	}

	currentRev(): number {
		return this.rev;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}
