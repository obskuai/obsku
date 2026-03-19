import { getErrorMessage, getErrorStack } from "../error-utils";
import { debugLog } from "./log";
import type { GenAiAttributes, TelemetryConfig } from "./types";

interface OtelSpan {
  end(): void;
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
}

interface OtelTracer {
  startSpan(name: string): OtelSpan;
}

interface OtelApi {
  SpanStatusCode: {
    ERROR: number;
    OK: number;
  };
  trace: {
    getTracer(name: string, version?: string): OtelTracer;
  };
}

/**
 * Apply attributes to a span record.
 */
function applyAttributesToRecord(
  record: SpanRecord,
  attributes: GenAiAttributes | undefined
): void {
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        record.attributes[key] = value;
      }
    }
  }
}

/**
 * Apply attributes to an OTel span.
 */
function applyAttributesToSpan(span: OtelSpan, attributes: GenAiAttributes | undefined): void {
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        span.setAttribute(key, value);
      }
    }
  }
}

let _otelApi: OtelApi | null = null;
let _loadAttempted = false;

async function loadOtelApi(): Promise<OtelApi | null> {
  if (_loadAttempted) {
    return _otelApi;
  }
  _loadAttempted = true;
  try {
    const mod = await import("@opentelemetry/api" as string);
    if (typeof mod.trace?.getTracer === "function") {
      _otelApi = mod as OtelApi;
    }
    return _otelApi;
  } catch (error: unknown) {
    debugLog(`OTel API not available: ${getErrorMessage(error)}. Stack: ${getErrorStack(error)}`);
    return null;
  }
}

export function _resetOtelLoader(): void {
  _otelApi = null;
  _loadAttempted = false;
}

export interface SpanRecord {
  attributes: Record<string, string | number | boolean>;
  children: Array<SpanRecord>;
  endCalled: boolean;
  name: string;
  status: "ok" | "error" | "unset";
}

let _spanRecords: Array<SpanRecord> = [];
let _activeSpanStack: Array<SpanRecord> = [];

export function getRecordedSpans(): Array<SpanRecord> {
  return _spanRecords;
}

export function clearRecordedSpans(): void {
  _spanRecords = [];
  _activeSpanStack = [];
}

/**
 * Wrap async fn in an OpenTelemetry span. No-op when disabled or deps missing.
 */
export async function withSpan<T>(
  config: TelemetryConfig | undefined,
  name: string,
  fn: () => Promise<T>,
  attributes?: GenAiAttributes
): Promise<T> {
  if (!config?.enabled) {
    return fn();
  }

  const otel = await loadOtelApi();

  // ALWAYS create record (before OTel check so both paths populate _spanRecords)
  const record: SpanRecord = {
    attributes: {},
    children: [],
    endCalled: false,
    name,
    status: "unset",
  };

  applyAttributesToRecord(record, attributes);

  const parent = _activeSpanStack.at(-1);
  if (parent) {
    parent.children.push(record);
  } else {
    _spanRecords.push(record);
  }

  _activeSpanStack.push(record);

  if (otel) {
    const tracer = otel.trace.getTracer(config.serviceName ?? "obsku", "0.1.0");
    const span = tracer.startSpan(name);

    applyAttributesToSpan(span, attributes);

    try {
      const result = await fn();
      span.setStatus({ code: otel.SpanStatusCode.OK });
      record.status = "ok";
      return result;
    } catch (error: unknown) {
      span.setStatus({
        code: otel.SpanStatusCode.ERROR,
        message: getErrorMessage(error),
      });
      record.status = "error";
      throw error;
    } finally {
      span.end();
      record.endCalled = true;
      _activeSpanStack.pop();
    }
  }

  // Fallback path: just update record
  try {
    const result = await fn();
    record.status = "ok";
    return result;
  } catch (error: unknown) {
    record.status = "error";
    throw error;
  } finally {
    record.endCalled = true;
    _activeSpanStack.pop();
  }
}

export function addSpanAttributes(
  config: TelemetryConfig | undefined,
  attributes: GenAiAttributes
): void {
  if (!config?.enabled) {
    return;
  }

  const current = _activeSpanStack.at(-1);
  if (current) {
    applyAttributesToRecord(current, attributes);
  }
}
