import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { ToolOutput } from "@obsku/framework";
import { getErrorMessage, plugin } from "@obsku/framework";
import { z } from "zod";
import { escapeRegex, findFilesRecursive, validatePath } from "./utils";

/** Default limit for search results to prevent excessive memory usage. */
export const DEFAULT_MAX_RESULTS = 100;
export interface GrepMatch {
  column: number;
  context?: { after: Array<string>; before: Array<string> };
  file: string;
  line: number;
  match: string;
}

export interface GrepResult {
  results: Array<GrepMatch>;
  skippedFiles: number;
  totalFiles: number;
  truncated: boolean;
}

export const grep = (basePath: string) =>
  plugin({
    description: "Search file contents with regex or literal pattern",
    name: "grep",
    params: z.object({
      contextLines: z.number().default(0),
      exclude: z.array(z.string()).optional(),
      include: z.string().optional(),
      maxResults: z.number().default(DEFAULT_MAX_RESULTS),
      path: z.string(),
      pattern: z.string(),
      useRegex: z.boolean().default(true),
    }),
    run: async (input) => {
      const {
        contextLines,
        exclude,
        include,
        maxResults,
        path: searchPath,
        pattern: searchPattern,
        useRegex,
      } = input;

      const resolvedPath = validatePath(basePath, searchPath);

      let regex: RegExp;
      try {
        regex = useRegex
          ? new RegExp(searchPattern, "g")
          : new RegExp(escapeRegex(searchPattern), "g");
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        const errorOutput: ToolOutput = {
          content: `Invalid regex pattern: ${errorMessage}`,
          isError: true,
        };
        return errorOutput;
      }

      const files = await findFilesRecursive(resolvedPath, { exclude, include });
      const results: Array<GrepMatch> = [];
      let hitLimit = false;
      let skippedFiles = 0;

      for (const file of files) {
        if (results.length >= maxResults) {
          hitLimit = true;
          break;
        }

        let content: string;
        try {
          content = await readFile(file, "utf8");
        } catch {
          skippedFiles++;
          continue;
        }

        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0;
          const m = regex.exec(lines[i]);
          if (m) {
            const entry: GrepMatch = {
              column: m.index + 1,
              file: relative(resolvedPath, file),
              line: i + 1,
              match: m[0],
            };

            if (contextLines > 0) {
              entry.context = {
                after: lines.slice(i + 1, Math.min(lines.length, i + 1 + contextLines)),
                before: lines.slice(Math.max(0, i - contextLines), i),
              };
            }

            results.push(entry);

            if (results.length >= maxResults) {
              hitLimit = true;
              break;
            }
          }
        }
      }

      return {
        results,
        skippedFiles,
        totalFiles: files.length,
        truncated: hitLimit,
      } satisfies GrepResult;
    },
  });
