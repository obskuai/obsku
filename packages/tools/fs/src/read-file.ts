import { readFile as fsReadFile } from "node:fs/promises";
import type { ToolOutput } from "@obsku/framework";
import { plugin } from "@obsku/framework";
import { z } from "zod";
import { handleFsError, validatePath } from "./utils";

export const readFile = (basePath: string) =>
  plugin({
    description: "Read file contents with optional offset and line limit",
    name: "readFile",
    params: z.object({
      limit: z.number().optional().describe("Max lines to return"),
      offset: z.number().optional().describe("Line number to start from (1-indexed)"),
      path: z.string(),
    }),
    run: async (
      input
    ): Promise<{ content: string; totalLines: number; truncated: boolean } | ToolOutput> => {
      const { limit, offset, path } = input;
      const filePath = validatePath(basePath, path);
      const resolvedOffset = offset ?? 1;

      try {
        const raw = await fsReadFile(filePath, "utf8");
        const allLines = raw.split("\n");
        const totalLines = allLines.length;

        const startIdx = Math.max(0, resolvedOffset - 1);
        const sliced =
          limit !== undefined
            ? allLines.slice(startIdx, startIdx + limit)
            : allLines.slice(startIdx);
        const truncated = startIdx + sliced.length < totalLines;

        return {
          content: sliced.join("\n"),
          totalLines,
          truncated,
        };
      } catch (error: unknown) {
        return handleFsError(error, path);
      }
    },
  });
