import { readFile, writeFile } from "node:fs/promises";
import type { ToolOutput } from "@obsku/framework";
import { plugin } from "@obsku/framework";
import { z } from "zod";
import { handleFsError, validatePath } from "./utils";

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while (true) {
    idx = haystack.indexOf(needle, idx);
    if (idx === -1) {
      break;
    }
    count++;
    idx += needle.length;
  }
  return count;
}

export const editFile = (basePath: string) =>
  plugin({
    description: "Edit file with search/replace",
    directives: [
      {
        inject:
          "The file you edited contains comments. Review them carefully as they may contain important context about the code.",
        match: (result: string) => result.includes("//") || result.includes("/*"),
        name: "comment-review",
      },
    ],
    name: "editFile",
    params: z.object({
      newString: z.string(),
      oldString: z.string(),
      path: z.string(),
    }),
    run: async (
      input
    ): Promise<{ path: string; replacements: number; success: boolean } | ToolOutput> => {
      const { newString, oldString, path } = input;
      const filePath = validatePath(basePath, path);

      try {
        const content = await readFile(filePath, "utf8");

        if (!content.includes(oldString)) {
          return { content: `oldString not found in file: ${path}`, isError: true };
        }

        const replacements = countOccurrences(content, oldString);
        const updated = content.replaceAll(oldString, newString);
        await writeFile(filePath, updated, "utf8");

        return { path: filePath, replacements, success: true };
      } catch (error: unknown) {
        return handleFsError(error, path);
      }
    },
  });
