import { getErrorMessage, getErrorStack } from "../error-utils";
import { debugLog } from "./log";
export interface TelemetrySetupOptions {
  enabled?: boolean;
  endpoint?: string;
  exporter?: "otlp" | "console" | "none";
  serviceName: string;
}

interface SdkHandle {
  shutdown(): Promise<void>;
  start(): void;
}

let _sdk: SdkHandle | null = null;

export async function setupTelemetry(options: TelemetrySetupOptions): Promise<void> {
  if (options.enabled === false || _sdk) {
    return;
  }

  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node" as string);
    const { Resource } = await import("@opentelemetry/resources" as string);
    const { SEMRESATTRS_SERVICE_NAME } = await import(
      "@opentelemetry/semantic-conventions" as string
    );

    const exporter =
      options.exporter ?? (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? "otlp" : "none");

    if (exporter === "none") {
      return;
    }

    let traceExporter: { export(): void; shutdown(): Promise<void> };
    switch (exporter) {
      case "otlp": {
        const { OTLPTraceExporter } = await import(
          "@opentelemetry/exporter-trace-otlp-http" as string
        );
        traceExporter = new OTLPTraceExporter({
          url: options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        });
        break;
      }
      case "console": {
        const { ConsoleSpanExporter } = await import("@opentelemetry/sdk-trace-node" as string);
        traceExporter = new ConsoleSpanExporter();
        break;
      }
      default:
        return;
    }

    const sdk = new NodeSDK({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: options.serviceName,
      }),
      traceExporter,
    });

    if (typeof sdk.start !== "function" || typeof sdk.shutdown !== "function") {
      throw new Error("Invalid OTel SDK");
    }

    _sdk = sdk as SdkHandle;
    _sdk.start();
  } catch (error: unknown) {
    debugLog(`setup failed: ${getErrorMessage(error)}. Stack: ${getErrorStack(error)}`);
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (_sdk) {
    try {
      await _sdk.shutdown();
    } catch (error: unknown) {
      debugLog(`shutdown failed: ${getErrorMessage(error)}. Stack: ${getErrorStack(error)}`);
    } finally {
      _sdk = null;
    }
  }
}

export function _resetSdkState(): void {
  _sdk = null;
}

export function _getSdk(): SdkHandle | null {
  return _sdk;
}
