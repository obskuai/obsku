import { basename, relative } from "node:path";
import type { ToolOutput } from "@obsku/framework";
import { getErrorMessage, plugin } from "@obsku/framework";
import { z } from "zod";
import { globFiles, validatePath } from "./utils";
import { DEFAULT_MAX_RESULTS } from "./grep";
export interface GlobEntry {
  name: string;
  path: string;
}

export interface GlobResult {
  files: Array<GlobEntry>;
  truncated: boolean;
}

export const glob = (basePath: string) =>
  plugin({
    description: "Find files matching glob pattern",
    name: "glob",
    params: z.object({
      gitignore: z.boolean().default(true),
      maxResults: z.number().default(DEFAULT_MAX_RESULTS),
      path: z.string().default("."),
      pattern: z.string(),
    }),
    run: async (input) => {
      const { gitignore, maxResults, path: searchPath, pattern } = input;

      const resolvedPath = validatePath(basePath, searchPath);

      try {
        const files = await globFiles(resolvedPath, pattern, {
          gitignore,
          maxResults: maxResults + 1,
        });

        const truncated = files.length > maxResults;

        return {
          files: files.slice(0, maxResults).map((f) => ({
            name: basename(f),
            path: relative(resolvedPath, f),
          })),
          truncated,
        } satisfies GlobResult;
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        const errorOutput: ToolOutput = {
          content: `Permission error accessing directory: ${errorMessage}`,
          isError: true,
        };
        return errorOutput;
      }
    },
  });
