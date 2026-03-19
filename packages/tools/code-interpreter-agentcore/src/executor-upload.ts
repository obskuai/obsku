import type { StructuredContentInvoker } from "./executor-invoke";
import { rethrowStageError } from "./executor-stage-error";
import { serializeInputFiles } from "./file-ops";
import { type S3UploadConfig, S3Uploader } from "./s3-uploader";
import type { ExecutionResult } from "./types";

export async function uploadInputFiles(
  invoke: StructuredContentInvoker,
  inputFiles: Map<string, string | Uint8Array> | undefined,
  abortSignal: AbortSignal
): Promise<Array<string>> {
  const inputFileNames = inputFiles ? [...inputFiles.keys()] : [];
  if (!inputFiles || inputFiles.size === 0) {
    return inputFileNames;
  }
  try {
    await invoke("writeFiles", { files: serializeInputFiles(inputFiles) }, abortSignal);
    return inputFileNames;
  } catch (error: unknown) {
    rethrowStageError("uploadInputFiles", error);
  }
}

export async function uploadResultToS3(
  result: ExecutionResult,
  sessionId: string,
  s3Upload: S3UploadConfig | undefined
): Promise<ExecutionResult> {
  if (!s3Upload) {
    return result;
  }
  return new S3Uploader(s3Upload).uploadResult(result, sessionId);
}
