import type { StructuredContentInvoker } from "./executor-invoke";
import { rethrowStageError } from "./executor-stage-error";
import { uploadInputFiles } from "./executor-upload";
import { fetchOutputFiles } from "./file-ops";
import type { StructuredContent } from "./parser";
import type { ExecutionOptions } from "./types";

export type ExecutionStageResult = {
  content: StructuredContent | undefined;
  startedAt: number;
};

export type OrchestratedExecutionState = {
  execution: ExecutionStageResult;
  outputFiles: Map<string, Uint8Array> | undefined;
};

async function executeCode(
  invoke: StructuredContentInvoker,
  code: string,
  language: string,
  abortSignal: AbortSignal
): Promise<ExecutionStageResult> {
  try {
    const startedAt = Date.now();
    const content = await invoke("executeCode", { code, language }, abortSignal);
    return { content, startedAt };
  } catch (error: unknown) {
    rethrowStageError("execute", error);
  }
}

async function fetchStageOutputFiles(
  invoke: StructuredContentInvoker,
  inputFileNames: Array<string>,
  abortSignal: AbortSignal
): Promise<Map<string, Uint8Array> | undefined> {
  try {
    return fetchOutputFiles(invoke, inputFileNames, abortSignal);
  } catch (error: unknown) {
    rethrowStageError("parseOutput", error);
  }
}

export async function runExecutionStages(
  invoke: StructuredContentInvoker,
  options: ExecutionOptions,
  abortSignal: AbortSignal
): Promise<OrchestratedExecutionState> {
  const inputFileNames = await uploadInputFiles(invoke, options.inputFiles, abortSignal);
  const execution = await executeCode(invoke, options.code, options.language, abortSignal);
  const outputFiles = await fetchStageOutputFiles(invoke, inputFileNames, abortSignal);
  return { execution, outputFiles };
}
