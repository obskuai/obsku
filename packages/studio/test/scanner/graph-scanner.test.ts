import { describe, expect, test } from "bun:test";
import path from "node:path";
import { scanGraphs } from "../../src/scanner/graph-scanner.js";

const fixturesDir = path.join(import.meta.dir, "fixtures");

describe("scanGraphs", () => {
  test("finds exported graph() calls with runtime loading metadata", () => {
    const results = scanGraphs({ rootDir: fixturesDir });

    expect(results).toHaveLength(3);
    expect(results.map((result) => result.exportName)).toEqual([
      "nestedGraph",
      "customerSupportGraph",
      "default",
    ]);

    const supportGraph = results.find((result) => result.exportName === "customerSupportGraph");
    expect(supportGraph).toBeDefined();
    expect(supportGraph?.modulePath).toBe("graphs");
    expect(supportGraph?.metadata.entry).toBe("start");
    expect(supportGraph?.metadata.nodes).toEqual({
      approval: { id: "approval", type: "agent" },
      finish: { id: "finish", type: "fn" },
      nested: { id: "nested", type: "graph" },
      start: { description: "Start node", id: "start", type: "agent" },
    });
    expect(supportGraph?.metadata.edges).toEqual([
      { from: "start", to: "approval" },
      { from: "approval", to: "nested" },
      { from: "nested", to: "finish" },
    ]);
    expect(supportGraph?.metadata.backEdges).toEqual([
      { back: true, from: "finish", to: "approval" },
    ]);
    expect(supportGraph?.metadata.executionOrder).toEqual([
      "start",
      "approval",
      "nested",
      "finish",
    ]);

    const defaultGraph = results.find((result) => result.exportName === "default");
    expect(defaultGraph?.metadata.entry).toBe("only");
    expect(defaultGraph?.metadata.executionOrder).toEqual(["only"]);
  });

  test("skips ignored file patterns", () => {
    const results = scanGraphs({ rootDir: fixturesDir });
    const entries = results.map((result) => result.metadata.entry);

    expect(entries).not.toContain("missing");
  });
});
