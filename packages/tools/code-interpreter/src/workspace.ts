import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export { PathTraversalError } from "@obsku/framework/security";

import { validatePath } from "@obsku/framework/security";

export interface WorkspaceContext {
  cleanup: () => Promise<void>;
  collectOutputFiles: (excludeInputs: Array<string>) => Promise<Map<string, Uint8Array>>;
  dir: string;
  stageFile: (name: string, content: string | Uint8Array) => Promise<string>;
}

function validateFilename(workspaceDir: string, filename: string): string {
  return validatePath(workspaceDir, filename);
}

export async function createWorkspace(): Promise<WorkspaceContext> {
  const tempDir = tmpdir();
  const workspaceDir = await mkdtemp(join(tempDir, "obsku-code-"));

  const cleanup = async (): Promise<void> => {
    await rm(workspaceDir, { force: true, recursive: true });
  };

  const stageFile = async (name: string, content: string | Uint8Array): Promise<string> => {
    const safePath = validateFilename(workspaceDir, name);
    await mkdir(dirname(safePath), { recursive: true });
    const data = typeof content === "string" ? content : content;
    await writeFile(safePath, data);
    return safePath;
  };

  const collectOutputFiles = async (
    excludeInputs: Array<string>
  ): Promise<Map<string, Uint8Array>> => {
    const files = await readdir(workspaceDir);
    const outputFiles = new Map<string, Uint8Array>();

    for (const filename of files) {
      if (excludeInputs.includes(filename)) {
        continue;
      }

      const filePath = join(workspaceDir, filename);
      const fileStat = await stat(filePath);

      if (fileStat.isFile()) {
        const content = await readFile(filePath);
        outputFiles.set(filename, new Uint8Array(content));
      }
    }

    return outputFiles;
  };

  return {
    cleanup,
    collectOutputFiles,
    dir: workspaceDir,
    stageFile,
  };
}
