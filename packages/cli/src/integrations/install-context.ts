/** Bearer token written into agent MCP entries during `install`. */
let installBearer: string | undefined;
/** MCP HTTP URL written into agent entries during `install` (defaults to loopback). */
let installMcpUrl: string | undefined;

export function setInstallBearer(token: string | undefined): void {
	installBearer = token?.trim() || undefined;
}

export function setInstallMcpUrl(url: string | undefined): void {
	installMcpUrl = url?.trim().replace(/\/$/, "") || undefined;
}

export function installMcpBaseUrl(): string | undefined {
	return installMcpUrl;
}

export function installBearerToken(): string | undefined {
	return installBearer;
}

export function installAuthHeaders(): Record<string, string> | undefined {
	if (!installBearer) return undefined;
	return { Authorization: `Bearer ${installBearer}` };
}
