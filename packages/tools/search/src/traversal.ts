/**
 * Recursive directory traversal.
 *
 * Delegates filtering to file-filter and error handling to error-policy.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { matchesGitignore } from "@obsku/framework/security";
import { handleTraversalError } from "./error-policy";
import { matchesExclude, matchesInclude } from "./file-filter";

export interface FindFilesOptions {
  exclude?: Array<string>;
  gitignorePatterns?: string[] | null;
  include?: string;
  maxFiles?: number;
}

export async function findFilesRecursive(
  dirPath: string,
  options: FindFilesOptions = {},
  collected: Array<string> = []
): Promise<Array<string>> {
  const { exclude, gitignorePatterns, include, maxFiles } = options;

  if (maxFiles !== undefined && collected.length >= maxFiles) {
    return collected;
  }

  let entries: Array<{ name: string | Buffer; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error: unknown) {
    return handleTraversalError(error, dirPath, collected);
  }

  for (const entry of entries) {
    if (maxFiles !== undefined && collected.length >= maxFiles) {
      break;
    }

    const isDir = entry.isDirectory();
    const entryName = String(entry.name);

    if (gitignorePatterns && matchesGitignore(entryName, isDir, gitignorePatterns)) {
      continue;
    }

    if (exclude && matchesExclude(entryName, exclude)) {
      continue;
    }

    const fullPath = join(dirPath, entryName);

    if (isDir) {
      await findFilesRecursive(fullPath, options, collected);
    } else {
      if (include && !matchesInclude(entryName, include)) {
        continue;
      }
      collected.push(fullPath);
    }
  }

  return collected;
}
