export interface ToolResultPayload {
  isError: boolean;
  result: string;
}

export interface NormalizedToolResultBoundary<T = unknown> {
  envelope: ToolResultEnvelope<T>;
  output: {
    content: string;
    isError: boolean;
  };
}

export type ToolResultEnvelope<T = unknown> =
  | { data: T; error: null; status: "completed"; success: true }
  | {
      data: null;
      error: string;
      status: "completed" | "failed" | "not_found" | "timeout";
      success: false;
    }
  | {
      data: null;
      error: null;
      startedAt: number;
      status: "running";
      success: false;
    };

export type FailedToolResultStatus = "completed" | "failed" | "not_found" | "timeout";
export type ToolResultObject = Record<string, unknown>;
export type ToolResultEnvelopeParser<T> = (
  record: ToolResultObject
) => ToolResultEnvelope<T> | null;
export type ToolResultBoundaryParser<T> = (
  value: unknown
) => NormalizedToolResultBoundary<T> | null;
export type ToolResultPayloadParser = (value: unknown) => ToolResultPayload | null;

export interface WrappedToolResultCandidate {
  isError?: boolean;
  result: string;
}

export interface ToolOutput {
  content: string;
  isError?: boolean;
}
