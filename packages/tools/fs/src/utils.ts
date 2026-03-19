function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e;
}

import type { ToolOutput } from "@obsku/framework";

export { PathTraversalError, SymlinkEscapeError, validatePath } from "@obsku/framework/security";

export function handleFsError(error: unknown, path: string): ToolOutput {
  if (isErrnoException(error) && error.code === "ENOENT") {
    return { content: `File/Path not found: ${path}`, isError: true };
  }
  if (isErrnoException(error) && error.code === "EACCES") {
    return { content: `Permission denied: ${path}`, isError: true };
  }
  throw error;
}
