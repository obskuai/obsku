import { existsSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

export class PathTraversalError extends Error {
  readonly _tag = "PathTraversalError" as const;
  constructor(readonly requestedPath: string) {
    super(`Path traversal blocked: ${requestedPath}`);
    this.name = "PathTraversalError";
  }
}

export class SymlinkEscapeError extends Error {
  readonly _tag = "SymlinkEscapeError" as const;
  constructor(readonly requestedPath: string) {
    super(`Symlink escape blocked: ${requestedPath}`);
    this.name = "SymlinkEscapeError";
  }
}

/**
 * Validate that a requested path stays within basePath.
 * Blocks path traversal (../) and symlink escapes.
 */
export function validatePath(basePath: string, requestedPath: string): string {
  // Explicit check for '..' sequences to catch Windows-style traversal (..\)
  // on POSIX systems where backslashes are treated as literal characters
  if (requestedPath.includes("..")) {
    throw new PathTraversalError(requestedPath);
  }

  const resolvedBase = resolve(basePath);
  const resolvedPath = resolve(resolvedBase, requestedPath);

  // Must be under basePath
  if (!resolvedPath.startsWith(resolvedBase + sep) && resolvedPath !== resolvedBase) {
    throw new PathTraversalError(requestedPath);
  }

  // Check symlinks don't escape
  if (existsSync(resolvedPath)) {
    const realPath = realpathSync(resolvedPath);
    if (!realPath.startsWith(resolvedBase + sep) && realPath !== resolvedBase) {
      throw new SymlinkEscapeError(requestedPath);
    }
  }

  return resolvedPath;
}
