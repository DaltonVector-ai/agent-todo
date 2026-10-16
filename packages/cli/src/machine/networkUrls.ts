import { networkInterfaces } from "node:os";

/** Printable http:// URLs for this machine on the given port (non-loopback). */
export function machineHttpUrls(port: number): string[] {
	const urls: string[] = [];
	const nets = networkInterfaces();
	for (const entries of Object.values(nets)) {
		if (!entries) continue;
		for (const entry of entries) {
			if (entry.internal || entry.family !== "IPv4") continue;
			urls.push(`http://${entry.address}:${port}`);
		}
	}
	return [...new Set(urls)].sort();
}
