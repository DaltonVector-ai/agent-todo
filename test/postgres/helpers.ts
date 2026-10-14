import { GenericContainer, Wait } from "testcontainers";

export async function startPostgres(): Promise<{
	databaseUrl: string;
	stop: () => Promise<void>;
}> {
	const container = await new GenericContainer("postgres:16")
		.withEnvironment({
			POSTGRES_USER: "agent",
			POSTGRES_PASSWORD: "agent",
			POSTGRES_DB: "agenttodo",
		})
		.withExposedPorts(5432)
		.withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
		.start();
	const host = container.getHost();
	const port = container.getMappedPort(5432);
	const databaseUrl = `postgres://agent:agent@${host}:${port}/agenttodo`;
	return {
		databaseUrl,
		stop: async () => {
			await container.stop();
		},
	};
}

export const hasDocker = async (): Promise<boolean> => {
	try {
		const { execSync } = await import("node:child_process");
		execSync("docker info", { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
};
