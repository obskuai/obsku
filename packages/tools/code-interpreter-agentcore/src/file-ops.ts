import type { ToolName } from "@aws-sdk/client-bedrock-agentcore";
import type { StructuredContent } from "./parser";

export type ResourceEntry = {
  resource: {
    blob?: Record<string, number>;
    mimeType?: string;
    uri?: string;
  };
  type: "resource";
};

export function isResourceEntry(entry: { type?: string }): entry is ResourceEntry {
  return (
    entry.type === "resource" &&
    typeof (entry as { resource?: unknown }).resource === "object" &&
    (entry as { resource?: unknown }).resource !== null
  );
}

export function serializeInputFiles(
  inputFiles: Map<string, string | Uint8Array>
): Array<{ content: string; encoding?: string; name: string }> {
  return Array.from(inputFiles.entries()).map(([name, content]) => {
    if (typeof content === "string") {
      return { content, name };
    }
    return {
      content: Buffer.from(content).toString("base64"),
      encoding: "base64",
      name,
    };
  });
}

export function extractFileNames(structured?: StructuredContent): Array<string> {
  if (!structured) {
    return [];
  }
  // New API format: result.content[] with resource_link entries
  if (Array.isArray(structured.content)) {
    return structured.content
      .filter(
        (entry): entry is typeof entry & { name: string } =>
          entry.type === "resource_link" &&
          entry.description === "File" &&
          typeof entry.name === "string"
      )
      .map((entry) => entry.name);
  }
  // Legacy format: fileNames array
  if (Array.isArray(structured.fileNames)) {
    return structured.fileNames.filter((name): name is string => typeof name === "string");
  }
  // Legacy format: files array
  if (Array.isArray(structured.files)) {
    return structured.files
      .map((entry) => (typeof entry === "string" ? entry : entry.name))
      .filter((name): name is string => typeof name === "string");
  }
  return [];
}

export function decodeFileContent(content: string | Uint8Array, encoding?: string): Uint8Array {
  if (typeof content !== "string") {
    return content;
  }
  if (encoding === "base64") {
    return Uint8Array.from(Buffer.from(content, "base64"));
  }
  return new TextEncoder().encode(content);
}

export function extractFiles(structured?: StructuredContent): Map<string, Uint8Array> {
  const outputFiles = new Map<string, Uint8Array>();
  if (!structured) {
    return outputFiles;
  }

  // New API format: content[] with resource entries containing blob data
  if (Array.isArray(structured.content)) {
    for (const entry of structured.content) {
      if (!isResourceEntry(entry)) {
        continue;
      }
      const resource = entry.resource;
      if (!resource.uri || !resource.blob) {
        continue;
      }
      const name = resource.uri.replace("file:///", "");
      const blobObj = resource.blob;
      const bytes = new Uint8Array(Object.keys(blobObj).length);
      for (const [idx, val] of Object.entries(blobObj)) {
        if (typeof val === "number") {
          bytes[Number(idx)] = val;
        }
      }
      outputFiles.set(name, bytes);
    }
    return outputFiles;
  }

  // Legacy format: files array
  if (Array.isArray(structured.files)) {
    for (const entry of structured.files) {
      if (typeof entry === "string") {
        continue;
      }
      if (!entry.name || entry.content === undefined) {
        continue;
      }
      const content = decodeFileContent(entry.content, entry.encoding);
      outputFiles.set(entry.name, content);
    }
  }

  return outputFiles;
}

type ContentInvoker = (
  name: ToolName,
  args?: Record<string, unknown>,
  signal?: AbortSignal
) => Promise<StructuredContent | undefined>;

export async function fetchOutputFiles(
  invoke: ContentInvoker,
  inputFileNames: Array<string>,
  abortSignal?: AbortSignal
): Promise<Map<string, Uint8Array> | undefined> {
  const listContent = await invoke("listFiles", {}, abortSignal);
  const fileNames = extractFileNames(listContent).filter((name) => !inputFileNames.includes(name));
  if (fileNames.length === 0) {
    return undefined;
  }

  const readContent = await invoke("readFiles", { paths: fileNames }, abortSignal);
  const outputFiles = extractFiles(readContent);
  return outputFiles.size > 0 ? outputFiles : undefined;
}
