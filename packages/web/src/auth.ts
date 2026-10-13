const STORAGE_KEY = "agent-todo-board-token";

export function getBoardToken(): string | null {
	try {
		return sessionStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

export function setBoardToken(token: string): void {
	sessionStorage.setItem(STORAGE_KEY, token.trim());
}

export function clearBoardToken(): void {
	sessionStorage.removeItem(STORAGE_KEY);
}
