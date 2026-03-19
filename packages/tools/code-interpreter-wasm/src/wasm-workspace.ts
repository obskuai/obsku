import { randomUUID } from "node:crypto";
import { posix } from "node:path";

export { PathTraversalError } from "@obsku/framework/security";

import { PathTraversalError } from "@obsku/framework/security";
import { MAX_INPUT_FILE_BYTES, MAX_TOTAL_OUTPUT_BYTES } from "@obsku/tool-code-interpreter";

export class FileSizeLimitError extends Error {
  constructor(filename: string, size: number, limit: number) {
    super(`File '${filename}' size ${size} exceeds input limit of ${limit} bytes`);
    this.name = "FileSizeLimitError";
  }
}

export class OutputSizeLimitError extends Error {
  constructor(total: number, limit: number) {
    super(`Total output size ${total} exceeds limit of ${limit} bytes`);
    this.name = "OutputSizeLimitError";
  }
}

interface EmscriptenFS {
  isFile(mode: number): boolean;
  mkdir(path: string): void;
  readdir(path: string): Array<string>;
  readFile(path: string): Uint8Array;
  stat(path: string): { mode: number };
  writeFile(path: string, data: Uint8Array): void;
}

export interface WasmWorkspaceContext {
  cleanup(): Promise<void>;
  collectOutputFiles(excludeInputs: Array<string>): Promise<Map<string, Uint8Array>>;
  dir: string;
  mountToEmscriptenFS(pyodideFS: EmscriptenFS): Promise<void>;
  stageFile(name: string, content: string | Uint8Array): Promise<string>;
  syncFromEmscriptenFS(pyodideFS: EmscriptenFS, dir: string): Promise<void>;
  toQuickJSGlobals(): Record<string, Uint8Array>;
}

export function mkdirSafe(fs: { mkdir(path: string): void }, path: string): void {
  try {
    fs.mkdir(path);
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code !== "EEXIST"
    ) {
      throw error;
    }
  }
}

function validateVirtualFilename(baseDir: string, filename: string): string {
  // Explicit check for '..' sequences to catch Windows-style traversal (..\)
  // on POSIX systems where backslashes are treated as literal characters
  if (filename.includes("..")) {
    throw new PathTraversalError(filename);
  }

  const resolvedBase = posix.resolve(baseDir);
  const resolvedPath = posix.resolve(resolvedBase, filename);
  if (!resolvedPath.startsWith(resolvedBase + "/") && resolvedPath !== resolvedBase) {
    throw new PathTraversalError(filename);
  }
  return resolvedPath;
}

export async function createWasmWorkspace(): Promise<WasmWorkspaceContext> {
  const id = randomUUID();
  const dir = `/wasm-workspace/${id}`;
  const store = new Map<string, Uint8Array>();

  const cleanup = async (): Promise<void> => {
    store.clear();
  };

  const stageFile = async (name: string, content: string | Uint8Array): Promise<string> => {
    const virtualPath = validateVirtualFilename(dir, name);

    const data = typeof content === "string" ? new TextEncoder().encode(content) : content;

    if (data.byteLength > MAX_INPUT_FILE_BYTES) {
      throw new FileSizeLimitError(name, data.byteLength, MAX_INPUT_FILE_BYTES);
    }

    store.set(name, data);
    return virtualPath;
  };

  const collectOutputFiles = async (
    excludeInputs: Array<string>
  ): Promise<Map<string, Uint8Array>> => {
    const result = new Map<string, Uint8Array>();
    let totalBytes = 0;

    for (const [key, value] of store) {
      if (excludeInputs.includes(key)) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > MAX_TOTAL_OUTPUT_BYTES) {
        throw new OutputSizeLimitError(totalBytes, MAX_TOTAL_OUTPUT_BYTES);
      }

      result.set(key, value);
    }

    return result;
  };

  const mountToEmscriptenFS = async (pyodideFS: EmscriptenFS): Promise<void> => {
    mkdirSafe(pyodideFS, dir);

    for (const [name, data] of store) {
      const filePath = `${dir}/${name}`;
      const parentDir = posix.dirname(filePath);
      if (parentDir && parentDir !== dir) {
        mkdirSafe(pyodideFS, parentDir);
      }
      pyodideFS.writeFile(filePath, data);
    }
  };

  const syncFromEmscriptenFS = async (pyodideFS: EmscriptenFS, fsDir: string): Promise<void> => {
    const entries: Array<string> = pyodideFS.readdir(fsDir);
    for (const entry of entries) {
      if (entry === "." || entry === "..") {
        continue;
      }
      const entryPath = `${fsDir}/${entry}`;
      const stat = pyodideFS.stat(entryPath);
      if (pyodideFS.isFile(stat.mode)) {
        const data: Uint8Array = pyodideFS.readFile(entryPath);
        store.set(
          entry,
          Object.prototype.toString.call(data) === "[object Uint8Array]"
            ? data
            : new Uint8Array(data)
        );
      }
    }
  };

  const toQuickJSGlobals = (): Record<string, Uint8Array> => {
    const result: Record<string, Uint8Array> = {};
    for (const [key, value] of store) {
      result[key] = value;
    }
    return result;
  };

  return {
    cleanup,
    collectOutputFiles,
    dir,
    mountToEmscriptenFS,
    stageFile,
    syncFromEmscriptenFS,
    toQuickJSGlobals,
  };
}
