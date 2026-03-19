import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ToolOutput } from "@obsku/framework";
import { plugin } from "@obsku/framework";
import { matchesGitignore, parseGitignorePatterns } from "@obsku/framework/security";
import { z } from "zod";
import { handleFsError, validatePath } from "./utils";

interface DirEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

async function listDirImpl(
  dirPath: string,
  basePath: string,
  recursive: boolean,
  gitignorePatterns: string[] | null
): Promise<Array<DirEntry>> {
  const entries: Array<DirEntry> = [];
  const dirEntries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of dirEntries) {
    const isDir = entry.isDirectory();
    const entryName = entry.name;

    if (gitignorePatterns && matchesGitignore(entryName, isDir, gitignorePatterns)) {
      continue;
    }

    const fullPath = join(dirPath, entryName);
    const relativePath = relative(basePath, fullPath);

    entries.push({
      name: entryName,
      path: relativePath,
      type: isDir ? "dir" : "file",
    });

    if (recursive && isDir) {
      const subEntries = await listDirImpl(fullPath, basePath, true, gitignorePatterns);
      entries.push(...subEntries);
    }
  }

  return entries;
}

export const listDir = (basePath: string) =>
  plugin({
    description: "List directory contents, optionally recursive and respecting .gitignore",
    name: "listDir",
    params: z.object({
      gitignore: z.boolean().default(false).describe("Respect .gitignore"),
      path: z.string(),
      recursive: z.boolean().default(false),
    }),
    run: async (input): Promise<{ entries: Array<DirEntry> } | ToolOutput> => {
      const { gitignore, path, recursive } = input;
      const dirPath = validatePath(basePath, path);

      let gitignorePatterns: string[] | null = null;
      if (gitignore) {
        const gitignorePath = join(basePath, ".gitignore");
        try {
          const content = await readFile(gitignorePath, "utf8");
          gitignorePatterns = parseGitignorePatterns(content);
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      }
      try {
        const entries = await listDirImpl(dirPath, basePath, recursive, gitignorePatterns);
        return { entries };
      } catch (error: unknown) {
        return handleFsError(error, path);
      }
    },
  });
