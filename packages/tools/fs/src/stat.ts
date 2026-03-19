import { lstat } from "node:fs/promises";
import type { ToolOutput } from "@obsku/framework";
import { plugin } from "@obsku/framework";
import { z } from "zod";
import { handleFsError, validatePath } from "./utils";

export const stat = (basePath: string) =>
  plugin({
    description: "Get file or directory stats (type, size, timestamps)",
    name: "stat",
    params: z.object({
      path: z.string(),
    }),
    run: async (
      input
    ): Promise<
      | {
          created: string;
          exists: true;
          modified: string;
          size: number;
          type: "file" | "dir" | "link";
        }
      | ToolOutput
    > => {
      const { path } = input;
      const filePath = validatePath(basePath, path);

      try {
        const stats = await lstat(filePath);
        const type = stats.isSymbolicLink()
          ? ("link" as const)
          : stats.isDirectory()
            ? ("dir" as const)
            : ("file" as const);

        return {
          created: stats.birthtime.toISOString(),
          exists: true,
          modified: stats.mtime.toISOString(),
          size: stats.size,
          type,
        };
      } catch (error: unknown) {
        return handleFsError(error, path);
      }
    },
  });
