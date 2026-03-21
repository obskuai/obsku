import { describe, expect, test } from "bun:test";
import {
  buildSupervisorPrompt,
  parseSupervisorOutput,
  supervisor,
} from "../../src/multi-agent/supervisor";
import type { AgentDef } from "../../src/types";
import { mockLLMProvider } from "../utils/mock-llm-provider";

describe("supervisor()", () => {
  const mockProvider = mockLLMProvider();

  const createAgent = (name: string, prompt: string): AgentDef => ({
    name,
    prompt,
  });

  test("supervisor() returns valid Graph", () => {
    const workers = [createAgent("w1", "Worker 1 prompt"), createAgent("w2", "Worker 2 prompt")];
    const g = supervisor({ name: "boss", provider: mockProvider, workers });

    expect(g.entry).toBe("boss");
    expect(g.nodes.size).toBe(1);
    expect(g.edges.length).toBe(0);
    expect(g.backEdges.length).toBe(0);
  });

  test("parseSupervisorOutput handles JSON object", () => {
    expect(parseSupervisorOutput({ next: "w1" })).toEqual({ next: "w1" });
    expect(parseSupervisorOutput({ next: "FINISH" })).toEqual({ next: "FINISH" });
  });

  test("parseSupervisorOutput handles JSON string", () => {
    expect(parseSupervisorOutput('{"next": "w1"}')).toEqual({ next: "w1" });
    expect(parseSupervisorOutput('{"next": "FINISH"}')).toEqual({ next: "FINISH" });
  });

  test("parseSupervisorOutput falls back to FINISH on invalid JSON", () => {
    expect(parseSupervisorOutput("invalid json")).toEqual({ next: "FINISH" });
    expect(parseSupervisorOutput("")).toEqual({ next: "FINISH" });
    expect(parseSupervisorOutput("{ broken")).toEqual({ next: "FINISH" });
  });

  test("parseSupervisorOutput falls back to FINISH on non-object output", () => {
    expect(parseSupervisorOutput(123)).toEqual({ next: "FINISH" });
    expect(parseSupervisorOutput(null)).toEqual({ next: "FINISH" });
    expect(parseSupervisorOutput(undefined)).toEqual({ next: "FINISH" });
    expect(parseSupervisorOutput([])).toEqual({ next: "FINISH" });
  });

  test("parseSupervisorOutput extracts JSON from markdown json code block", () => {
    expect(parseSupervisorOutput('```json\n{"next": "researcher"}\n```')).toEqual({
      next: "researcher",
    });
    expect(parseSupervisorOutput('```json\n{"next": "analyst"}\n```')).toEqual({ next: "analyst" });
  });

  test("parseSupervisorOutput extracts JSON from markdown code block without language", () => {
    expect(parseSupervisorOutput('```\n{"next": "worker1"}\n```')).toEqual({ next: "worker1" });
    expect(parseSupervisorOutput('```\n{"next": "FINISH"}\n```')).toEqual({ next: "FINISH" });
  });

  test("parseSupervisorOutput extracts bare JSON object from text", () => {
    expect(parseSupervisorOutput('Some text\n{"next": "analyst"}\nMore text')).toEqual({
      next: "analyst",
    });
    expect(parseSupervisorOutput('I will route to {"next": "researcher"} now')).toEqual({
      next: "researcher",
    });
  });

  test("parseSupervisorOutput handles nested markdown with multiple code blocks", () => {
    const input = 'I am ready...\n\n```json\n{ "next": "researcher" }\n```\n\nMore text after';
    expect(parseSupervisorOutput(input)).toEqual({ next: "researcher" });
  });

  test("parseSupervisorOutput uses first code block when multiple present", () => {
    const input = '```json\n{"next": "first"}\n```\n```json\n{"next": "second"}\n```';
    expect(parseSupervisorOutput(input)).toEqual({ next: "first" });
  });

  test("parseSupervisorOutput falls back to FINISH on malformed JSON in code block", () => {
    expect(parseSupervisorOutput("```json\n{ broken json }\n```")).toEqual({ next: "FINISH" });
    expect(parseSupervisorOutput("```\n{ not valid }\n```")).toEqual({ next: "FINISH" });
  });

  test("parseSupervisorOutput falls back to FINISH on unclosed code fence with invalid JSON", () => {
    // Unclosed fence where content is not valid JSON
    expect(parseSupervisorOutput("```json\n{not valid json")).toEqual({ next: "FINISH" });
  });

  test("parseSupervisorOutput handles empty json code fence", () => {
    // Empty code fence should fall back to FINISH
    expect(parseSupervisorOutput("```json\n```")).toEqual({ next: "FINISH" });
  });

  test("parseSupervisorOutput handles whitespace-only code fence", () => {
    // Code fence with only whitespace should fall back to FINISH
    expect(parseSupervisorOutput("```json\n   \n```")).toEqual({ next: "FINISH" });
  });

  test("parseSupervisorOutput extracts JSON from extra backtick fences", () => {
    // Four backticks should still work (extractJsonFromText handles this)
    expect(parseSupervisorOutput('````json\n{"next": "worker"}\n````')).toEqual({
      next: "worker",
    });
  });

  test("parseSupervisorOutput falls back to FINISH when first code block is invalid but second is valid", () => {
    // Current behavior: only first code block is tried, if invalid -> FINISH
    const input = '```json\n{invalid}\n```\n```json\n{"next": "worker"}\n```';
    expect(parseSupervisorOutput(input)).toEqual({ next: "FINISH" });
  });

  test("parseSupervisorOutput falls back to FINISH on valid JSON that fails schema validation", () => {
    // Valid JSON but missing 'next' field
    expect(parseSupervisorOutput('{"other": "value"}')).toEqual({ next: "FINISH" });
    // Valid JSON but wrong type for 'next'
    expect(parseSupervisorOutput('{"next": 123}')).toEqual({ next: "FINISH" });
    // Valid JSON but 'next' is an object
    expect(parseSupervisorOutput('{"next": {"nested": "value"}}')).toEqual({ next: "FINISH" });
  });

  test("parseSupervisorOutput falls back to FINISH on bare array", () => {
    // Arrays are objects but fail schema validation
    expect(parseSupervisorOutput("[1, 2, 3]")).toEqual({ next: "FINISH" });
    expect(parseSupervisorOutput('[{"next": "worker"}]')).toEqual({ next: "FINISH" });
  });

  test("parseSupervisorOutput handles JSON with unicode and special characters", () => {
    expect(parseSupervisorOutput('{"next": "worker_ñame-123"}')).toEqual({
      next: "worker_ñame-123",
    });
    expect(parseSupervisorOutput('```json\n{"next": "test emoji 🎉"}\n```')).toEqual({
      next: "test emoji 🎉",
    });
  });

  test("parseSupervisorOutput handles leading/trailing whitespace in JSON", () => {
    expect(parseSupervisorOutput('  {"next": "worker"}  ')).toEqual({ next: "worker" });
    expect(parseSupervisorOutput('\n\t{"next": "worker"}\n\t')).toEqual({ next: "worker" });
  });

  test("parseSupervisorOutput falls back to FINISH on code fence with JSON-like but invalid content", () => {
    // Single quotes instead of double
    expect(parseSupervisorOutput("```json\n{'next': 'worker'}\n```")).toEqual({ next: "FINISH" });
    // Trailing comma
    expect(parseSupervisorOutput('```json\n{"next": "worker",}\n```')).toEqual({ next: "FINISH" });
    // Unquoted key
    expect(parseSupervisorOutput('```json\n{next: "worker"}\n```')).toEqual({ next: "FINISH" });
  });

  test("parseSupervisorOutput extracts first valid JSON from multiple code blocks correctly", () => {
    // First block valid, second also valid - should use first
    const input = '```json\n{"next": "first"}\n```\n```json\n{"next": "second"}\n```';
    expect(parseSupervisorOutput(input)).toEqual({ next: "first" });
  });
  test("supervisor emits parse.error then finish on invalid routing output", async () => {
    const events: Array<unknown> = [];
    const provider = {
      async chat() {
        return {
          content: [{ text: "not json", type: "text" as const }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
      async *chatStream() {
        yield undefined as never;
        throw new Error("Not implemented");
      },
      contextWindowSize: 200_000,
    };
    const g = supervisor({
      name: "boss",
      onEvent: (event) => events.push(event),
      provider,
      workers: [createAgent("w1", "Worker 1 prompt")],
    });

    const node = g.nodes.get("boss");
    const executor = node?.executor as ((input: unknown) => Promise<unknown>) | undefined;
    const result = await executor?.("route this");

    expect(result).toEqual({ finalContext: [], results: {} });
    expect(events).toContainEqual(
      expect.objectContaining({
        data: {
          error: "Supervisor routing parse-failed; defaulting to FINISH",
          rawInput: "not json",
        },
        type: "parse.error",
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        data: { next: "FINISH", round: 0 },
        type: "supervisor.routing",
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({ data: { rounds: 0 }, type: "supervisor.finish" })
    );
  });

  test("buildSupervisorPrompt includes all workers", () => {
    const workers = [
      createAgent("researcher", "Research things"),
      createAgent("writer", "Write content"),
    ];
    const prompt = buildSupervisorPrompt(workers);

    expect(prompt).toContain("researcher");
    expect(prompt).toContain("writer");
    expect(prompt).toContain("Research things");
    expect(prompt).toContain("Write content");
    expect(prompt).toContain('"next": "<worker_name>"');
    expect(prompt).toContain('"next": "FINISH"');
  });

  test("buildSupervisorPrompt truncates long prompts", () => {
    const longPrompt = "a".repeat(200);
    const workers = [createAgent("w1", longPrompt)];
    const prompt = buildSupervisorPrompt(workers);

    expect(prompt).toContain("...");
    expect(prompt).not.toContain("a".repeat(150));
  });

  test("custom prompt works", () => {
    const workers = [createAgent("w1", "p1")];
    const customPrompt = "Custom supervisor instructions";
    const g = supervisor({
      name: "boss",
      prompt: customPrompt,
      provider: mockProvider,
      workers,
    });

    const node = g.nodes.get("boss");
    expect(node).toBeDefined();
    expect(typeof node!.executor).toBe("function");
  });

  test("auto-generated prompt when none provided", () => {
    const workers = [createAgent("w1", "Worker one")];
    const g = supervisor({ name: "boss", provider: mockProvider, workers });

    const node = g.nodes.get("boss");
    expect(node).toBeDefined();
    expect(typeof node!.executor).toBe("function");
  });

  test("empty workers throws error", () => {
    expect(() => supervisor({ name: "boss", provider: mockProvider, workers: [] })).toThrow(
      "Supervisor requires at least one worker"
    );
  });

  test("graph validation passes", () => {
    const workers = [createAgent("w1", "p1"), createAgent("w2", "p2"), createAgent("w3", "p3")];
    const g = supervisor({ name: "boss", provider: mockProvider, workers });

    expect(g.executionOrder.length).toBe(1);
    expect(g.executionOrder[0]).toBe("boss");
    expect(g.adjacency.has("boss")).toBe(true);
  });

  test("dynamic prompt shows [dynamic] in supervisor prompt", () => {
    const workers = [{ name: "w1", prompt: () => "Dynamic prompt" }] as Array<AgentDef>;
    const prompt = buildSupervisorPrompt(workers);

    expect(prompt).toContain("[dynamic]");
  });
});
