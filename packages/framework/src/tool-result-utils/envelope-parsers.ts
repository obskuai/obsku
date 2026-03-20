import { safeJsonParse } from "../json-utils";
import { asRecord, isTerminalFailureStatus, normalizeFailedStatus, toErrorMessage } from "./shared";
import type {
  ToolResultEnvelope,
  ToolResultEnvelopeParser,
  ToolResultObject,
  WrappedToolResultCandidate,
} from "./types";

interface CanonicalDiscriminator<T> {
  key: string;
  test: (record: ToolResultObject) => boolean;
  parse: (record: ToolResultObject) => ToolResultEnvelope<T> | null;
}

function buildSuccessEnvelope<T>(data: unknown): ToolResultEnvelope<T> {
  return {
    data: data as T,
    error: null,
    status: "completed",
    success: true,
  };
}

function buildRunningEnvelope(startedAt: number): ToolResultEnvelope<never> {
  return {
    data: null,
    error: null,
    startedAt,
    status: "running",
    success: false,
  };
}

function buildFailureEnvelope(
  error: string,
  status: "completed" | "failed" | "not_found" | "timeout"
): ToolResultEnvelope<never> {
  return {
    data: null,
    error,
    status,
    success: false,
  };
}

function getCanonicalDiscriminators<T>(): Array<CanonicalDiscriminator<T>> {
  return [
    {
      key: "success-strict",
      test: (r) =>
        r.success === true && r.status === "completed" && r.error === null && "data" in r,
      parse: (r) => buildSuccessEnvelope<T>(r.data),
    },
    {
      key: "running-strict",
      test: (r) =>
        r.success === false &&
        r.status === "running" &&
        r.data === null &&
        r.error === null &&
        typeof r.startedAt === "number",
      parse: (r) => buildRunningEnvelope(r.startedAt as number),
    },
    {
      key: "failure-terminal",
      test: (r) =>
        r.success === false &&
        r.data === null &&
        typeof r.error === "string" &&
        isTerminalFailureStatus(r.status),
      parse: (r) =>
        buildFailureEnvelope(
          r.error as string,
          r.status as "completed" | "failed" | "not_found" | "timeout"
        ),
    },
  ];
}

export function parseCanonicalEnvelope<T>(record: ToolResultObject): ToolResultEnvelope<T> | null {
  for (const discriminator of getCanonicalDiscriminators<T>()) {
    if (discriminator.test(record)) {
      return discriminator.parse(record);
    }
  }
  return null;
}

export function parseFailedEnvelopeLikeEnvelope<T>(
  record: ToolResultObject
): ToolResultEnvelope<T> | null {
  if (record.success !== false) {
    return null;
  }

  if (record.status === "running" && typeof record.startedAt === "number") {
    return buildRunningEnvelope(record.startedAt);
  }

  return buildFailureEnvelope(
    typeof record.error === "string" ? record.error : toErrorMessage(record.error),
    normalizeFailedStatus(record.status)
  );
}

export function getWrappedToolResultCandidate(value: unknown): WrappedToolResultCandidate | null {
  const record = asRecord(value);
  if (record == null || typeof record.result !== "string") {
    return null;
  }

  if (record.isError !== undefined && typeof record.isError !== "boolean") {
    return null;
  }

  return {
    isError: typeof record.isError === "boolean" ? record.isError : undefined,
    result: record.result,
  };
}

export function parseWrappedToolPayloadEnvelope<T>(
  record: ToolResultObject
): ToolResultEnvelope<T> | null {
  const candidate = getWrappedToolResultCandidate(record);
  if (candidate == null) {
    return null;
  }

  return normalizeStringBackedToolResultEnvelope<T>(candidate.result, candidate.isError);
}

export function parseErrorRecordEnvelope<T>(
  record: ToolResultObject
): ToolResultEnvelope<T> | null {
  if (typeof record.error !== "string") {
    return null;
  }

  return buildFailureEnvelope(record.error, "completed");
}

function getObjectEnvelopeStages<T>(): Array<ToolResultEnvelopeParser<T>> {
  return [
    parseCanonicalEnvelope,
    parseFailedEnvelopeLikeEnvelope,
    parseWrappedToolPayloadEnvelope,
    parseErrorRecordEnvelope,
  ];
}

export function normalizeObjectToolResultEnvelope<T>(value: unknown): ToolResultEnvelope<T> | null {
  const record = asRecord(value);
  if (record == null) {
    return null;
  }

  for (const parseStage of getObjectEnvelopeStages<T>()) {
    const parsed = parseStage(record);
    if (parsed != null) {
      return parsed;
    }
  }

  return null;
}

export function normalizeStringBackedToolResultEnvelope<T>(
  value: string,
  isError?: boolean
): ToolResultEnvelope<T> {
  const parsed = safeJsonParse<T>(value);
  const nestedEnvelope = parsed.success ? normalizeObjectToolResultEnvelope<T>(parsed.data) : null;
  if (nestedEnvelope != null) {
    return nestedEnvelope;
  }

  if (isError === true) {
    return buildFailureEnvelope(
      parsed.success ? toErrorMessage(parsed.data) : (parsed.data as string),
      "completed"
    );
  }

  return buildSuccessEnvelope<T>(parsed.success ? parsed.data : value);
}

export function wrapRawValueAsCompletedSuccess<T>(value: unknown): ToolResultEnvelope<T> {
  return buildSuccessEnvelope<T>(value);
}
