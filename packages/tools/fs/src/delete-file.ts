import { unlink } from "node:fs/promises";
import type { ToolOutput } from "@obsku/framework";
import { plugin } from "@obsku/framework";
import { z } from "zod";
import { handleFsError, validatePath } from "./utils";

export const deleteFile = (basePath: string) =>
  plugin({
    description: "Delete a file",
    name: "deleteFile",
    params: z.object({
      path: z.string(),
    }),
    run: async (input): Promise<{ path: string; success: boolean } | ToolOutput> => {
      const { path } = input;
      const filePath = validatePath(basePath, path);

      try {
        await unlink(filePath);
        return { path: filePath, success: true };
      } catch (error: unknown) {
        return handleFsError(error, path);
      }
    },
  });
