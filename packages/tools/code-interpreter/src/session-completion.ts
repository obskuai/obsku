export type CompletionMode = "delimiter" | "exit" | "timeout" | "unavailable";

const COMPLETION_META = Symbol("session-read-completion");

export type ReadUntilDelimiterResult = {
  [COMPLETION_META]?: CompletionMode;
  exitCode: number;
  isTimeout: boolean;
  stderr: string;
  stdout: string;
};

type VisibleReadResult = Omit<ReadUntilDelimiterResult, typeof COMPLETION_META>;

export function attachCompletionMetadata(
  result: VisibleReadResult,
  completion: CompletionMode
): ReadUntilDelimiterResult {
  const enriched: ReadUntilDelimiterResult = { ...result };
  Object.defineProperty(enriched, COMPLETION_META, {
    configurable: false,
    enumerable: false,
    value: completion,
    writable: false,
  });
  return enriched;
}

export function readCompletion(result: ReadUntilDelimiterResult): CompletionMode {
  if (result[COMPLETION_META]) {
    return result[COMPLETION_META];
  }

  if (result.isTimeout) {
    return "timeout";
  }

  return result.exitCode === 0 ? "delimiter" : "exit";
}
