import { startCloudServer } from "@agent-todo/server";

export async function runServerCommand(): Promise<number> {
	try {
		const runtime = await startCloudServer();
		console.log(`agent-todo server listening on ${runtime.baseUrl}`);
		await new Promise<void>(() => {});
		return 0;
	} catch (err) {
		console.error(err);
		return 1;
	}
}
