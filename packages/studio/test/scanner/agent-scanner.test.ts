import { describe, expect, test } from "bun:test";
import path from "node:path";
import { scanAgents } from "../../src/scanner/agent-scanner.js";

const fixturesDir = path.join(import.meta.dir, "fixtures");

describe("scanAgents", () => {
  test("finds agent() createAgent() and AgentDef exports", () => {
    const results = scanAgents({ rootDir: fixturesDir });

    expect(results).toHaveLength(3);
    expect(results.map((result) => result.exportName)).toEqual([
      "helperAgent",
      "typedEscalationAgent",
      "default",
    ]);

    const helperAgent = results.find((result) => result.exportName === "helperAgent");
    expect(helperAgent).toBeDefined();
    expect(helperAgent?.modulePath).toBe("agents");
    expect(helperAgent?.line).toBeGreaterThan(0);
    expect(helperAgent?.metadata.name).toBe("helper-agent");
    expect(helperAgent?.metadata.prompt).toBe("You help users quickly.");
    expect(helperAgent?.metadata.tools).toEqual([{ name: "echoTool" }, { name: "delegateTool" }]);
    expect(helperAgent?.metadata.maxIterations).toBe(7);
    expect(helperAgent?.metadata.streaming).toBe(true);
    expect(helperAgent?.metadata.memoryConfig).toMatchObject({
      enabled: true,
      longTermMemory: true,
      maxFactsToInject: 4,
      type: "summarization",
    });
    expect(helperAgent?.metadata.handoffs).toEqual([
      { agent: "triage-agent", description: "Escalate to triage" },
    ]);
    expect(helperAgent?.metadata.guardrails).toEqual({ input: 1, output: 2 });

    const typedAgent = results.find((result) => result.exportName === "typedEscalationAgent");
    expect(typedAgent?.metadata.name).toBe("escalation-agent");
    expect(typedAgent?.metadata.prompt).toBe("Escalate unresolved issues.");
    expect(typedAgent?.metadata.memoryConfig).toMatchObject({ type: "none" });

    const defaultAgent = results.find((result) => result.exportName === "default");
    expect(defaultAgent?.metadata.name).toBe("factory-agent");
    expect(defaultAgent?.modulePath).toBe("agents");
  });

  test("skips ignored file patterns", () => {
    const results = scanAgents({ rootDir: fixturesDir });
    const names = results.map((result) => result.metadata.name);

    expect(names).not.toContain("ignored-test-agent");
    expect(names).not.toContain("skipped-node-modules-agent");
  });
});
