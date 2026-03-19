export { debugLog } from "./log";
export type { SpanRecord } from "./tracer";
export {
  _resetOtelLoader,
  addSpanAttributes,
  clearRecordedSpans,
  getRecordedSpans,
  withSpan,
} from "./tracer";
export type { GenAiAttributes, TelemetryConfig } from "./types";
