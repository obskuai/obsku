import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectProviders } from "../../src/scanner/provider-scanner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("detectProviders", () => {
  test("detects a bedrock provider import", async () => {
    const cwd = await createProject({
      "src/index.ts": 'import { bedrock } from "@obsku/provider-bedrock";\nvoid bedrock;\n',
    });

    await expect(detectProviders(cwd)).resolves.toEqual([
      { package: "@obsku/provider-bedrock", providerIds: ["bedrock"] },
    ]);
  });

  test("returns an empty array when no provider imports exist", async () => {
    const cwd = await createProject({
      "src/index.ts": 'export const value = "no providers";\n',
    });

    await expect(detectProviders(cwd)).resolves.toEqual([]);
  });

  test("ignores provider imports inside node_modules", async () => {
    const cwd = await createProject({
      "src/index.ts": 'export const value = "root";\n',
      "node_modules/demo/index.ts":
        'import { bedrock } from "@obsku/provider-bedrock";\nvoid bedrock;\n',
    });

    await expect(detectProviders(cwd)).resolves.toEqual([]);
  });

  test("maps ai-sdk imports to all supported sub-providers when no factory call is found", async () => {
    const cwd = await createProject({
      "src/index.ts":
        'import { anthropic, google } from "@obsku/provider-ai-sdk";\nexport const providers = [anthropic, google];\n',
    });

    await expect(detectProviders(cwd)).resolves.toEqual([
      {
        package: "@obsku/provider-ai-sdk",
        providerIds: ["anthropic", "google", "groq", "openai"],
      },
    ]);
  });

  test("narrows ai-sdk detection to called sub-factories", async () => {
    const cwd = await createProject({
      "src/index.ts":
        'import { anthropic as makeAnthropic, google } from "@obsku/provider-ai-sdk";\nawait makeAnthropic({ model: "claude-sonnet-4-20250514" });\nvoid google;\n',
    });

    await expect(detectProviders(cwd)).resolves.toEqual([
      { package: "@obsku/provider-ai-sdk", providerIds: ["anthropic"] },
    ]);
  });

  test("skips ollama because it is embedding-only", async () => {
    const cwd = await createProject({
      "src/index.ts": 'import { ollama } from "@obsku/provider-ollama";\nvoid ollama;\n',
    });

    await expect(detectProviders(cwd)).resolves.toEqual([]);
  });
});

async function createProject(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "obsku-provider-scanner-"));
  tempDirs.push(cwd);

  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const filePath = path.join(cwd, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, "utf8");
    })
  );

  return cwd;
}
