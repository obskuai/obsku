import {
  getWrappedToolResultCandidate,
  normalizeStringBackedToolResultEnvelope,
  parseCanonicalEnvelope,
  parseErrorRecordEnvelope,
  parseFailedEnvelopeLikeEnvelope,
  wrapRawValueAsCompletedSuccess,
} from "./envelope-parsers";
import { asRecord, isToolOutput, serializeToolResultContent } from "./shared";
import type {
  NormalizedToolResultBoundary,
  ToolResultEnvelope,
  ToolResultObject,
} from "./types";

function isEnvelopeError(envelope: ToolResultEnvelope<unknown>): boolean {
  return envelope.success === false && envelope.status !== "running";
}

function createBoundary<T>(
  envelope: ToolResultEnvelope<T>,
  content: string,
  isError = isEnvelopeError(envelope)
): NormalizedToolResultBoundary<T> {
  return {
    envelope,
    output: {
      content,
      isError,
    },
  };
}

function parseCanonicalBoundaryRecord<T>(
  record: ToolResultObject
): NormalizedToolResultBoundary<T> | null {
  const envelope = parseCanonicalEnvelope<T>(record);
  return envelope == null ? null : createBoundary(envelope, serializeToolResultContent(record));
}

export function parseCanonicalBoundary<T>(value: unknown): NormalizedToolResultBoundary<T> | null {
  const record = asRecord(value);
  return record == null ? null : parseCanonicalBoundaryRecord(record);
}

export function parseFailedEnvelopeLikeBoundary<T>(
  value: unknown
): NormalizedToolResultBoundary<T> | null {
  const record = asRecord(value);
  if (record == null) {
    return null;
  }

  const envelope = parseFailedEnvelopeLikeEnvelope<T>(record);
  return envelope == null ? null : createBoundary(envelope, serializeToolResultContent(record));
}

export function parseWrappedToolPayloadBoundary<T>(
  value: unknown
): NormalizedToolResultBoundary<T> | null {
  const candidate = getWrappedToolResultCandidate(value);
  if (candidate == null) {
    return null;
  }

  return createBoundary(
    normalizeStringBackedToolResultEnvelope<T>(candidate.result, candidate.isError),
    candidate.result
  );
}

export function parseToolOutputBoundary<T>(value: unknown): NormalizedToolResultBoundary<T> | null {
  if (!isToolOutput(value)) {
    return null;
  }

  return createBoundary(
    normalizeStringBackedToolResultEnvelope<T>(value.content, value.isError),
    value.content
  );
}

export function parseErrorRecordBoundary<T>(
  value: unknown
): NormalizedToolResultBoundary<T> | null {
  const record = asRecord(value);
  if (record == null) {
    return null;
  }

  const envelope = parseErrorRecordEnvelope<T>(record);
  return envelope == null ? null : createBoundary(envelope, serializeToolResultContent(record));
}

export function parseRawValueBoundary<T>(value: unknown): NormalizedToolResultBoundary<T> {
  return createBoundary(
    wrapRawValueAsCompletedSuccess<T>(value),
    serializeToolResultContent(value),
    false
  );
}
