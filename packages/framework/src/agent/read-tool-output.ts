import type { BlobStore } from "../blob/types";
import type { PluginDef } from "../types/index";
import { z } from "zod";

const DEFAULT_LIMIT = 10_000;

const ReadToolOutputSchema = z.object({
  limit: z.number().default(DEFAULT_LIMIT).describe("Max characters to return (default: 10000)"),
  offset: z.number().default(0).describe("Character offset (default: 0)"),
  ref: z.string().describe("Reference key from truncation message"),
});

export function createReadToolOutputPlugin(
  blobStore: BlobStore
): PluginDef<typeof ReadToolOutputSchema> {
  return {
    description: "Read full tool output that was truncated. Use ref from truncation notice.",
    name: "read_tool_output",
    params: ReadToolOutputSchema,
    run: async (input) => {
      const { limit, offset, ref } = input;

      const data = await blobStore.get(ref);
      if (!data) {
        return `Tool output ref not found: ${ref}`;
      }

      const full = data.toString("utf8");
      return full.slice(offset, offset + limit);
    },
  };
}
