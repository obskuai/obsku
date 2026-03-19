import { writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolOutput } from "@obsku/framework";
import { plugin } from "@obsku/framework";
import { z } from "zod";
import { handleFsError, validatePath } from "./utils";

export const writeFile = (basePath: string) =>
  plugin({
    description: "Write content to a file, optionally creating parent directories",
    name: "writeFile",
    params: z.object({
      content: z.string(),
      createDirs: z.boolean().default(false).describe("Auto-create parent directories"),
      path: z.string(),
    }),
    run: async (input): Promise<{ path: string; success: boolean } | ToolOutput> => {
      const { content, createDirs, path } = input;
      const filePath = validatePath(basePath, path);

      try {
        if (createDirs) {
          await mkdir(dirname(filePath), { recursive: true });
        }

        await fsWriteFile(filePath, content, "utf8");

        return { path: filePath, success: true };
      } catch (error: unknown) {
        return handleFsError(error, path);
      }
    },
  });
