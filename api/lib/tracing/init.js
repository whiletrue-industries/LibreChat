let _initialized = false;
function initTracing() {
  const endpoint = process.env.PHOENIX_COLLECTOR_ENDPOINT;
  if (!endpoint || _initialized) return;
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  // Phoenix rejects JSON OTLP with 415; the -proto exporter sends protobuf
  // and Phoenix accepts it on the same /v1/traces endpoint.
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
  const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
  const { OpenAIInstrumentation } = require('@arizeai/openinference-instrumentation-openai');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
  const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
  const { SecretScrubbingSpanProcessor } = require('./secretScrubber');

  const exporter = new OTLPTraceExporter({ url: endpoint });
  const inner = new BatchSpanProcessor(exporter, { maxQueueSize: 2048, scheduledDelayMillis: 1000 });
  const scrubbed = new SecretScrubbingSpanProcessor(inner);
  const sdk = new NodeSDK({
    serviceName: `librechat-${process.env.ENVIRONMENT || 'local'}`,
    spanProcessor: scrubbed,
    instrumentations: [
      new OpenAIInstrumentation(),
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
    ],
  });
  sdk.start();
  global.__otelTracerProvider = sdk;
  _initialized = true;
  console.log(`[tracing] phoenix initialized: ${endpoint}`);
}
module.exports = { initTracing };
