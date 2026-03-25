import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createApp } from "../../../src/server/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function createRootDir(files: Record<string, string>): string {
  const rootDir = mkdtempSync(join(tmpdir(), "studio-providers-"));
  tempDirs.push(rootDir);

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(rootDir, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  return rootDir;
}

describe("Providers API", () => {
  it("GET /api/providers returns known providers and config-selected active provider", async () => {
    const rootDir = createRootDir({
      "studio.config.ts": `export default { provider: "openai", model: "gpt-4o-mini" };\n`,
      "src/agent.ts": `import { openai } from "@obsku/provider-ai-sdk";\nconst provider = openai({ model: "gpt-4o" });\nexport default provider;\n`,
    });
    const app = createApp({ enableLogging: false, rootDir });

    const response = await app.request("http://localhost/api/providers");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      providers: [
        {
          id: "bedrock",
          name: "Amazon Bedrock",
          detected: false,
          defaultModel: "amazon.nova-lite-v1:0",
          models: [
            "amazon.nova-lite-v1:0",
            "anthropic.claude-3-sonnet-20240229-v1:0",
            "anthropic.claude-3-5-sonnet-20241022-v2:0",
            "meta.llama3-1-405b-instruct-v1:0",
          ],
        },
        {
          id: "anthropic",
          name: "Anthropic",
          detected: false,
          defaultModel: "claude-sonnet-4-20250514",
          models: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022"],
        },
        {
          id: "google",
          name: "Google AI",
          detected: false,
          defaultModel: "gemini-2.0-flash",
          models: ["gemini-2.0-flash", "gemini-1.5-pro"],
        },
        {
          id: "groq",
          name: "Groq",
          detected: false,
          defaultModel: "llama-3.3-70b-versatile",
          models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
        },
        {
          id: "openai",
          name: "OpenAI",
          detected: true,
          defaultModel: "gpt-4o",
          models: ["gpt-4o", "gpt-4o-mini"],
        },
      ],
      active: {
        id: "openai",
        source: "config",
      },
    });
  });

  it("GET /api/providers uses heuristic resolution when one provider is detected", async () => {
    const rootDir = createRootDir({
      "src/agent.ts": `import { google } from "@obsku/provider-ai-sdk";\nexport const provider = google({ model: "gemini-2.0-flash" });\n`,
    });
    const app = createApp({ enableLogging: false, rootDir });

    const response = await app.request("http://localhost/api/providers");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.active).toEqual({
      id: "google",
      source: "heuristic",
    });
    expect(payload.providers.find((provider: { id: string }) => provider.id === "google")).toEqual({
      id: "google",
      name: "Google AI",
      detected: true,
      defaultModel: "gemini-2.0-flash",
      models: ["gemini-2.0-flash", "gemini-1.5-pro"],
    });
  });
});
