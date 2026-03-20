/**
 * Glob pattern matching and glob file search.
 *
 * Supports **, *, ? wildcards. Loads .gitignore patterns and delegates
 * traversal to findFilesRecursive.
 */
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseGitignorePatterns } from "@obsku/framework/security";
import { findFilesRecursive } from "./traversal";

/**
 * Test whether `filePath` matches the glob `pattern`.
 * Supports: ** (any path), * (any segment), ? (any char except /), . (literal).
 */
export function globMatch(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const normalizedPattern = pattern.replaceAll("\\", "/");

  let regexStr = "^";
  let i = 0;
  while (i < normalizedPattern.length) {
    const c = normalizedPattern[i];
    if (c === "*") {
      if (normalizedPattern[i + 1] === "*") {
        if (normalizedPattern[i + 2] === "/") {
          regexStr += "(?:.+/)?";
          i += 3;
        } else {
          regexStr += ".*";
          i += 2;
        }
      } else {
        regexStr += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      regexStr += "[^/]";
      i++;
    } else if (c === ".") {
      regexStr += String.raw`\.`;
      i++;
    } else if (
      c === "$" ||
      c === "^" ||
      c === "+" ||
      c === "|" ||
      c === "(" ||
      c === ")" ||
      c === "{" ||
      c === "}" ||
      c === "["
    ) {
      regexStr += "\\" + c;
      i++;
    } else {
      regexStr += c;
      i++;
    }
  }
  regexStr += "$";

  return new RegExp(regexStr).test(normalizedPath);
}

/**
 * Find all files under `dirPath` that match the glob `pattern`.
 * Optionally respects .gitignore and caps results via `maxResults`.
 */
export async function globFiles(
  dirPath: string,
  pattern: string,
  options: { gitignore?: boolean; maxResults?: number } = {}
): Promise<Array<string>> {
  const { gitignore = true, maxResults } = options;

  let gitignorePatterns: string[] | null = null;
  if (gitignore) {
    const gitignorePath = join(dirPath, ".gitignore");
    try {
      const content = await readFile(gitignorePath, "utf8");
      gitignorePatterns = parseGitignorePatterns(content);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  const allFiles = await findFilesRecursive(dirPath, {
    gitignorePatterns,
    maxFiles: maxResults !== undefined ? maxResults * 10 : undefined,
  });

  const matched: Array<string> = [];
  for (const file of allFiles) {
    const relativePath = relative(dirPath, file).replaceAll("\\", "/");
    if (globMatch(relativePath, pattern)) {
      matched.push(file);
      if (maxResults !== undefined && matched.length >= maxResults) {
        break;
      }
    }
  }

  return matched;
}
