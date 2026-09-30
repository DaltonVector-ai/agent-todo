let started = false;

/** Initializes OpenTelemetry when OTEL_EXPORTER_OTLP_ENDPOINT is set. */
export async function initOtel(serviceName = "agent-todo-server"): Promise<void> {
	if (started) return;
	const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
	if (!endpoint) return;

	const { NodeSDK } = await import("@opentelemetry/sdk-node");
	const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
	const { resourceFromAttributes } = await import("@opentelemetry/resources");
	const { ATTR_SERVICE_NAME } = await import("@opentelemetry/semantic-conventions");

	const sdk = new NodeSDK({
		resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
		traceExporter: new OTLPTraceExporter({ url: endpoint }),
	});
	await sdk.start();
	started = true;
}
