import type { CodeInterpreterStreamOutput } from "@aws-sdk/client-bedrock-agentcore";
import { z } from "zod";

export type StructuredContent = {
  content?: Array<{
    data?: string;
    description?: string;
    mimeType?: string;
    name?: string;
    text?: string;
    type?: string;
    uri?: string;
  }>;
  executionTime?: number;
  exitCode?: number;
  fileNames?: Array<string>;
  files?: Array<string | { content?: string | Uint8Array; encoding?: string; name?: string }>;
  isError?: boolean;
  stderr?: string;
  stdout?: string;
};

export type InvokeResult = {
  stream?: AsyncIterable<CodeInterpreterStreamOutput> | undefined;
};

const fileEntrySchema = z.object({
  content: z.union([z.string(), z.instanceof(Uint8Array)]).optional(),
  encoding: z.string().optional(),
  name: z.string().optional(),
});

const contentItemSchema = z
  .object({
    data: z.string().optional(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    type: z.string().optional(),
    uri: z.string().optional(),
  })
  .catchall(z.unknown());

const structuredContentSchema = z
  .object({
    content: z.array(contentItemSchema).optional(),
    executionTime: z.number().optional(),
    exitCode: z.number().optional(),
    fileNames: z.array(z.string()).optional(),
    files: z.array(z.union([z.string(), fileEntrySchema])).optional(),
    isError: z.boolean().optional(),
    stderr: z.string().optional(),
    stdout: z.string().optional(),
  })
  .catchall(z.unknown());

const eventResultSchema = z.object({
  event: z.object({
    result: z.object({
      structuredContent: structuredContentSchema,
    }),
  }),
});

const directResultSchema = z.object({
  result: z.object({
    content: z.unknown().optional(),
    structuredContent: structuredContentSchema,
  }),
});

const contentListResultSchema = z.object({
  result: structuredContentSchema.extend({
    content: z.array(contentItemSchema),
  }),
});

export function isStructuredContent(value: unknown): value is StructuredContent {
  return contentListResultSchema.shape.result.safeParse(value).success;
}

export function isEventResult(
  value: unknown
): value is { event: { result: { structuredContent: StructuredContent } } } {
  return eventResultSchema.safeParse(value).success;
}

export function isDirectResult(
  value: unknown
): value is { result: { content?: unknown; structuredContent: StructuredContent } } {
  return directResultSchema.safeParse(value).success;
}

export function extractStructuredContent(
  output: CodeInterpreterStreamOutput
): StructuredContent | undefined {
  // Wire format 1: SSE envelope { event: { result: { structuredContent } } }
  const eventResult = eventResultSchema.safeParse(output);
  if (eventResult.success) {
    return eventResult.data.event.result.structuredContent;
  }

  // Wire format 2: direct RPC { result: { structuredContent } }
  const directResult = directResultSchema.safeParse(output);
  if (directResult.success) {
    return directResult.data.result.structuredContent;
  }

  // Wire format 3: content-list { result: { content: [...], ...structuredContent } }
  const contentListResult = contentListResultSchema.safeParse(output);
  if (contentListResult.success) {
    return contentListResult.data.result;
  }

  return undefined;
}

export function mergeStreamText(prev: string | undefined, next: string): string {
  if (!prev) {
    return next;
  }
  if (next.startsWith(prev)) {
    return next;
  }
  if (prev.startsWith(next)) {
    return prev;
  }
  return prev + next;
}

export function mergeStructuredContent(
  current: StructuredContent,
  next: StructuredContent
): StructuredContent {
  const merged: StructuredContent = { ...current, ...next };
  if (typeof next.stdout === "string") {
    merged.stdout = mergeStreamText(current.stdout, next.stdout);
  }
  if (typeof next.stderr === "string") {
    merged.stderr = mergeStreamText(current.stderr, next.stderr);
  }
  return merged;
}

export async function collectStructuredContent(
  stream?: AsyncIterable<CodeInterpreterStreamOutput>
): Promise<StructuredContent | undefined> {
  if (!stream) {
    return undefined;
  }

  let latest: StructuredContent | undefined;
  for await (const item of stream) {
    const structured = extractStructuredContent(item);
    if (!structured) {
      continue;
    }

    if (!latest) {
      latest = { ...structured };
      continue;
    }

    latest = mergeStructuredContent(latest, structured);
  }

  return latest;
}
