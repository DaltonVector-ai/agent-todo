/** Bearer token written into agent MCP entries during `install`. */
let installBearer: string | undefined;

export function setInstallBearer(token: string | undefined): void {
	installBearer = token?.trim() || undefined;
}

export function installBearerToken(): string | undefined {
	return installBearer;
}

export function installAuthHeaders(): Record<string, string> | undefined {
	if (!installBearer) return undefined;
	return { Authorization: `Bearer ${installBearer}` };
}
