import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("graph detail page", () => {
  const graphDetailPath = resolve(import.meta.dirname, "../../src/frontend/pages/GraphDetail.tsx");
  const appPath = resolve(import.meta.dirname, "../../src/frontend/App.tsx");
  const graphDetailContent = readFileSync(graphDetailPath, "utf-8");
  const appContent = readFileSync(appPath, "utf-8");

  it("wires GraphDetail into the frontend app", () => {
    expect(appContent).toContain('import GraphDetail from "./pages/GraphDetail"');
    expect(appContent).toContain("<GraphDetail />");
  });

  it("uses React Flow read-only canvas patterns", () => {
    expect(graphDetailContent).toContain("<ReactFlow");
    expect(graphDetailContent).toContain("<Background");
    expect(graphDetailContent).toContain("<Controls");
    expect(graphDetailContent).toContain("<MiniMap");
    expect(graphDetailContent).toContain("fitView");
    expect(graphDetailContent).toContain("nodesDraggable={false}");
    expect(graphDetailContent).toContain("nodesConnectable={false}");
  });

  it("defines visual distinctions for all node kinds", () => {
    expect(graphDetailContent).toContain('type GraphNodeKind = "agent" | "graph" | "function"');
    expect(graphDetailContent).toContain("agent:");
    expect(graphDetailContent).toContain("graph:");
    expect(graphDetailContent).toContain("function:");
    expect(graphDetailContent).toContain("Entry point");
    expect(graphDetailContent).toContain("executionOrder");
  });

  it("styles back-edges differently from regular edges", () => {
    expect(graphDetailContent).toContain("isBackEdge");
    expect(graphDetailContent).toContain('strokeDasharray: "8 6"');
    expect(graphDetailContent).toContain("getBezierPath");
  });
});
