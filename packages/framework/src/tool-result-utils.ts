export type {
  FailedToolResultStatus,
  NormalizedToolResultBoundary,
  ToolOutput,
  ToolResultEnvelope,
  ToolResultPayload,
} from "./tool-result-utils/types";

import {
  parseCanonicalBoundary,
  parseErrorRecordBoundary,
  parseFailedEnvelopeLikeBoundary,
  parseRawValueBoundary,
  parseToolOutputBoundary,
  parseWrappedToolPayloadBoundary,
} from "./tool-result-utils/boundary-parsers";
import {
  parseToolExecutionPayload,
  parseToolOutputPayload,
  parseWrappedToolResultPayload,
} from "./tool-result-utils/payload-parsers";
import { isToolOutput } from "./tool-result-utils/shared";
import type {
  NormalizedToolResultBoundary,
  ToolResultBoundaryParser,
  ToolResultEnvelope,
  ToolResultPayload,
  ToolResultPayloadParser,
} from "./tool-result-utils/types";

function getBoundaryParsingStages<T>(): Array<ToolResultBoundaryParser<T>> {
  return [
    parseCanonicalBoundary,
    parseFailedEnvelopeLikeBoundary,
    parseWrappedToolPayloadBoundary,
    parseToolOutputBoundary,
    parseErrorRecordBoundary,
  ];
}

export function normalizeToolResultBoundary<T = unknown>(
  value: unknown
): NormalizedToolResultBoundary<T> {
  for (const parseStage of getBoundaryParsingStages<T>()) {
    const parsed = parseStage(value);
    if (parsed != null) {
      return parsed;
    }
  }

  return parseRawValueBoundary<T>(value);
}

function getToolResultPayloadStages(): Array<ToolResultPayloadParser> {
  return [parseToolExecutionPayload, parseWrappedToolResultPayload, parseToolOutputPayload];
}

export function normalizeToolResultPayload(value: unknown): ToolResultPayload | null {
  for (const parseStage of getToolResultPayloadStages()) {
    const parsed = parseStage(value);
    if (parsed != null) {
      return parsed;
    }
  }

  return null;
}

export function toToolResultOutput(value: unknown): { content: string; isError?: boolean } {
  return normalizeToolResultBoundary(value).output;
}

export function toToolResultEnvelope<T = unknown>(value: unknown): ToolResultEnvelope<T> {
  return normalizeToolResultBoundary<T>(value).envelope;
}

export { isToolOutput };
