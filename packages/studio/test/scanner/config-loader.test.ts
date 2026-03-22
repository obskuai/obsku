import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  loadStudioConfig,
  mergeAgents,
  mergeGraphs,
} from "../../src/scanner/config-loader";
import type { AgentDef } from "@obsku/framework";
import type { Graph } from "@obsku/framework/graph";

describe("loadStudioConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "studio-config-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("no config file", () => {
    it("returns null when no config file exists", async () => {
      const result = await loadStudioConfig(tempDir);
      expect(result).toBeNull();
    });
  });

  describe("with valid config file", () => {
    it("loads studio.config.ts", async () => {
      const configPath = join(tempDir, "studio.config.ts");
      writeFileSync(
        configPath,
        `
        export default {
          agents: [{ name: "agent1", prompt: "test" }],
          graphs: [],
          scanDir: "./src",
          scanIgnore: ["node_modules"],
        };
      `
      );

      const result = await loadStudioConfig(tempDir);

      expect(result).not.toBeNull();
      expect(result!.configPath).toBe(configPath);
      expect(result!.config.agents).toHaveLength(1);
      expect(result!.config.agents[0].name).toBe("agent1");
      expect(result!.config.scanDir).toBe("./src");
      expect(result!.config.scanIgnore).toEqual(["node_modules"]);
    });

    it("loads studio.config.js", async () => {
      const configPath = join(tempDir, "studio.config.js");
      writeFileSync(
        configPath,
        `
        module.exports = {
          agents: [{ name: "js-agent", prompt: "test" }],
          graphs: [],
        };
      `
      );

      const result = await loadStudioConfig(tempDir);

      expect(result).not.toBeNull();
      expect(result!.config.agents[0].name).toBe("js-agent");
    });

    it("prefers .ts over .js", async () => {
      writeFileSync(
        join(tempDir, "studio.config.js"),
        `module.exports = { agents: [{ name: "js", prompt: "x" }] };`
      );
      writeFileSync(
        join(tempDir, "studio.config.ts"),
        `export default { agents: [{ name: "ts", prompt: "x" }] };`
      );

      const result = await loadStudioConfig(tempDir);

      expect(result!.config.agents[0].name).toBe("ts");
    });

    it("supports default export", async () => {
      writeFileSync(
        join(tempDir, "studio.config.ts"),
        `export default { agents: [{ name: "default-export", prompt: "x" }] };`
      );

      const result = await loadStudioConfig(tempDir);

      expect(result!.config.agents[0].name).toBe("default-export");
    });

    it("supports named exports", async () => {
      writeFileSync(
        join(tempDir, "studio.config.ts"),
        `export const agents = [{ name: "named-export", prompt: "x" }];`
      );

      const result = await loadStudioConfig(tempDir);

      expect(result!.config.agents[0].name).toBe("named-export");
    });
  });

  describe("with invalid config file", () => {
    it("throws error for invalid agent array", async () => {
      writeFileSync(
        join(tempDir, "studio.config.ts"),
        `export default { agents: "not-an-array" };`
      );

      await expect(loadStudioConfig(tempDir)).rejects.toThrow(
        /Invalid studio.config.ts/
      );
    });

    it("throws error for invalid scanIgnore", async () => {
      writeFileSync(
        join(tempDir, "studio.config.ts"),
        `export default { scanIgnore: "not-an-array" };`
      );

      await expect(loadStudioConfig(tempDir)).rejects.toThrow(
        /Invalid studio.config.ts/
      );
    });

    it("throws error for invalid scanDir type", async () => {
      writeFileSync(
        join(tempDir, "studio.config.ts"),
        `export default { scanDir: 123 };`
      );

      await expect(loadStudioConfig(tempDir)).rejects.toThrow(
        /Invalid studio.config.ts/
      );
    });
  });

  describe("default values", () => {
    it("provides empty arrays for missing optional fields", async () => {
      writeFileSync(join(tempDir, "studio.config.ts"), `export default {};`);

      const result = await loadStudioConfig(tempDir);

      expect(result!.config.agents).toEqual([]);
      expect(result!.config.graphs).toEqual([]);
      expect(result!.config.scanIgnore).toEqual([]);
      expect(result!.config.scanDir).toBeUndefined();
    });
  });
});

describe("mergeAgents", () => {
  it("combines agents from config and scanned", () => {
    const configAgents: AgentDef[] = [
      { name: "config-agent", prompt: "test" },
    ];
    const scannedAgents: AgentDef[] = [
      { name: "scanned-agent", prompt: "test" },
    ];

    const result = mergeAgents(configAgents, scannedAgents);

    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toContain("config-agent");
    expect(result.map((a) => a.name)).toContain("scanned-agent");
  });

  it("config agents take priority on name conflicts", () => {
    const configAgents: AgentDef[] = [
      { name: "shared-agent", prompt: "from-config" },
    ];
    const scannedAgents: AgentDef[] = [
      { name: "shared-agent", prompt: "from-scanned" },
    ];

    const result = mergeAgents(configAgents, scannedAgents);

    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe("from-config");
  });

  it("handles empty arrays", () => {
    expect(mergeAgents([], [])).toEqual([]);
    expect(mergeAgents([{ name: "a", prompt: "x" }], [])).toHaveLength(1);
    expect(mergeAgents([], [{ name: "a", prompt: "x" }])).toHaveLength(1);
  });
});

describe("mergeGraphs", () => {
  const createGraph = (entry: string): Graph =>
    ({
      entry,
      nodes: new Map(),
      edges: [],
      adjacency: new Map(),
      backEdges: [],
      executionOrder: [],
      config: { maxConcurrent: 3, nodeTimeout: 300000 },
      provider: {} as any,
    }) as Graph;

  it("combines graphs from config and scanned", () => {
    const configGraphs = [createGraph("config-entry")];
    const scannedGraphs = [createGraph("scanned-entry")];

    const result = mergeGraphs(configGraphs, scannedGraphs);

    expect(result).toHaveLength(2);
    expect(result.map((g) => g.entry)).toContain("config-entry");
    expect(result.map((g) => g.entry)).toContain("scanned-entry");
  });

  it("config graphs take priority on entry conflicts", () => {
    const configGraphs = [createGraph("shared-entry")];
    const scannedGraphs = [createGraph("shared-entry")];

    const result = mergeGraphs(configGraphs, scannedGraphs);

    expect(result).toHaveLength(1);
  });

  it("handles empty arrays", () => {
    expect(mergeGraphs([], [])).toEqual([]);
    expect(mergeGraphs([createGraph("a")], [])).toHaveLength(1);
    expect(mergeGraphs([], [createGraph("a")])).toHaveLength(1);
  });
});
