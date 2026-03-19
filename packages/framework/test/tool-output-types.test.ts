// TDD Test: ToolOutput Types - Error Status Propagation
// RED Phase: These tests verify that ToolOutput types exist and work correctly
// They will FAIL initially until we add the type definitions

import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import { buildSingleToolEffect, normalizeToolResult } from "../src/agent/result-normalization";
import type { ResolvedTool } from "../src/agent/setup";
import { executeApprovedSyncTools } from "../src/agent/sync-execution";
import { createToolExecutionResult } from "../src/agent/tool-execution-shared";
import type {
  AgentDef,
  PluginDef,
  StoredToolResult,
  ToolOutput,
  ToolResultContent,
  ToolResultContext,
  ToolUseContent,
} from "../src/index";
import { plugin as createPlugin } from "../src/plugin";
import type { ObskuConfig } from "../src/services/config";
import type { ToolResultEvent } from "../src/types/events";
import { isToolOutput } from "../src/utils";

const toolCall: ToolUseContent = {
  input: {},
  name: "baseline_tool",
  toolUseId: "toolu_baseline",
  type: "tool_use",
};

const testConfig: ObskuConfig = {
  maxIterations: 1,
  toolConcurrency: 1,
  toolTimeout: 100,
};

const minimalAgentDef: AgentDef = {
  name: "baseline-agent",
  prompt: "baseline",
};

describe("ToolOutput Types", () => {
  describe("ToolOutput interface", () => {
    it("should exist with content: string field", () => {
      const output: ToolOutput = {
        content: "some result",
      };

      expect(output.content).toBe("some result");
    });

    it("should have optional isError: boolean field", () => {
      const outputWithError: ToolOutput = {
        content: "error message",
        isError: true,
      };

      const outputWithoutError: ToolOutput = {
        content: "success message",
      };

      expect(outputWithError.isError).toBe(true);
      expect(outputWithoutError.isError).toBeUndefined();
    });

    it("should allow isError: false explicitly", () => {
      const output: ToolOutput = {
        content: "result",
        isError: false,
      };

      expect(output.isError).toBe(false);
    });
  });

  describe("isToolOutput() type guard", () => {
    it("should return true for ToolOutput object with content", () => {
      const valid = { content: "test" };
      expect(isToolOutput(valid)).toBe(true);
    });

    it("should return true for ToolOutput with isError", () => {
      const withError = { content: "error", isError: true };
      expect(isToolOutput(withError)).toBe(true);
    });

    it("should return false for string", () => {
      expect(isToolOutput("string value")).toBe(false);
    });

    it("should return false for number", () => {
      expect(isToolOutput(123)).toBe(false);
    });

    it("should return false for null", () => {
      expect(isToolOutput(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isToolOutput(undefined)).toBe(false);
    });

    it("should return false for object without content field", () => {
      expect(isToolOutput({ foo: 1 })).toBe(false);
    });

    it("should return false for object with non-string content", () => {
      expect(isToolOutput({ content: 123 })).toBe(false);
    });

    it("should return false for array", () => {
      expect(isToolOutput([1, 2, 3])).toBe(false);
    });
  });

  describe("ToolResultContent interface", () => {
    it("should accept status: 'success' | 'error'", () => {
      const successResult: ToolResultContent = {
        content: "success",
        status: "success",
        toolUseId: "tool-1",
        type: "tool_result",
      };

      const errorResult: ToolResultContent = {
        content: "error",
        status: "error",
        toolUseId: "tool-2",
        type: "tool_result",
      };

      expect(successResult.status).toBe("success");
      expect(errorResult.status).toBe("error");
    });

    it("should work without status field (backward compat)", () => {
      const result: ToolResultContent = {
        content: "result",
        toolUseId: "tool-1",
        type: "tool_result",
      };

      expect(result.status).toBeUndefined();
    });
  });

  describe("ToolResult event type", () => {
    it("should have isError?: boolean field", () => {
      const event: ToolResultEvent = {
        isError: true,
        result: "some result",
        timestamp: Date.now(),
        toolName: "test-tool",
        toolUseId: "tu-1",
        type: "tool.result",
      };

      expect(event.isError).toBe(true);
    });

    it("should work without isError field (backward compat)", () => {
      const event: ToolResultEvent = {
        result: "some result",
        timestamp: Date.now(),
        toolName: "test-tool",
        toolUseId: "tu-2",
        type: "tool.result",
      };

      expect(event.isError).toBeUndefined();
    });
  });

  describe("ToolResultContext interface", () => {
    it("should have isError?: boolean field", () => {
      const context: ToolResultContext = {
        input: { arg: "value" },
        isError: true,
        iteration: 1,
        result: "error result",
        toolName: "test-tool",
      };

      expect(context.isError).toBe(true);
    });

    it("should work without isError field (backward compat)", () => {
      const context: ToolResultContext = {
        input: { arg: "value" },
        iteration: 1,
        result: "success result",
        toolName: "test-tool",
      };

      expect(context.isError).toBeUndefined();
    });
  });

  describe("StoredToolResult interface", () => {
    it("should have status?: string field", () => {
      const result: StoredToolResult = {
        content: "error",
        status: "error",
        toolUseId: "tool-1",
      };

      expect(result.status).toBe("error");
    });

    it("should work without status field (backward compat)", () => {
      const result: StoredToolResult = {
        content: "success",
        toolUseId: "tool-1",
      };

      expect(result.status).toBeUndefined();
    });

    it("should preserve status through JSON serialization", () => {
      const result: StoredToolResult = {
        content: "error",
        status: "error",
        toolUseId: "tool-1",
      };

      const serialized = JSON.stringify(result);
      const deserialized: StoredToolResult = JSON.parse(serialized);

      expect(deserialized.status).toBe("error");
    });
  });

  describe("PluginDef.run() return type", () => {
    it("should accept ToolOutput as return value", () => {
      // Type-only test - verify PluginDef.run can return ToolOutput
      const plugin: PluginDef = {
        description: "Test plugin",
        name: "test-plugin",
        params: z.object({}),
        run: async () => {
          // Return ToolOutput
          return {
            content: "result",
            isError: true,
          };
        },
      };

      expect(plugin.name).toBe("test-plugin");
    });

    it("should still accept string return (backward compat)", () => {
      const plugin: PluginDef = {
        description: "Test plugin",
        name: "test-plugin",
        params: z.object({}),
        run: async () => {
          return "string result";
        },
      };

      expect(plugin.name).toBe("test-plugin");
    });

    it("should still accept object return (backward compat)", () => {
      const plugin: PluginDef = {
        description: "Test plugin",
        name: "test-plugin",
        params: z.object({}),
        run: async () => {
          return { foo: "bar" };
        },
      };

      expect(plugin.name).toBe("test-plugin");
    });
  });

  describe("tool failure normalization baselines", () => {
    it("preserves typed tool result error JSON as a string envelope", () => {
      const result = createToolExecutionResult(toolCall, JSON.stringify({ error: "boom" }), true);

      expect(normalizeToolResult(result)).toEqual({
        isError: true,
        result: JSON.stringify({ error: "boom" }),
      });
    });

    it("treats ToolOutput objects as typed string results", () => {
      expect(
        normalizeToolResult({ content: JSON.stringify({ error: "tool failed" }), isError: true })
      ).toEqual({
        isError: true,
        result: JSON.stringify({ error: "tool failed" }),
      });
    });

    it("stringifies canonical success envelopes through shared output normalization", async () => {
      const result = await Effect.runPromise(
        buildSingleToolEffect(
          Effect.succeed({
            data: { nested: true },
            error: null,
            status: "completed",
            success: true,
          }),
          toolCall,
          testConfig
        )
      );

      expect(result).toEqual({
        isError: false,
        result: JSON.stringify({
          data: { nested: true },
          error: null,
          status: "completed",
          success: true,
        }),
        toolName: "baseline_tool",
        toolUseId: "toolu_baseline",
      });
    });

    it("stringifies unexpected object results without adding an error flag", async () => {
      const result = await Effect.runPromise(
        buildSingleToolEffect(Effect.succeed({ nested: true }), toolCall, testConfig)
      );

      expect(result).toEqual({
        isError: false,
        result: JSON.stringify({ nested: true }),
        toolName: "baseline_tool",
        toolUseId: "toolu_baseline",
      });
    });

    it("wraps thrown tool errors in JSON string envelopes", async () => {
      const result = await Effect.runPromise(
        buildSingleToolEffect(Effect.fail(new Error("tool exploded")), toolCall, testConfig)
      );

      expect(result).toEqual({
        isError: true,
        result: JSON.stringify({ error: "tool exploded" }),
        toolName: "baseline_tool",
        toolUseId: "toolu_baseline",
      });
    });

    it("sync execution returns a JSON string envelope when the tool is missing", async () => {
      const [result] = await Effect.runPromise(
        executeApprovedSyncTools([toolCall], new Map(), minimalAgentDef, testConfig)
      );

      expect(result).toEqual({
        isError: true,
        result: JSON.stringify({ error: "Tool not found: baseline_tool" }),
        toolName: "baseline_tool",
        toolUseId: "toolu_baseline",
      });
    });

    it("sync execution keeps thrown plugin failures as JSON string envelopes", async () => {
      const explodingPlugin = createPlugin({
        description: "Explodes",
        name: "baseline_tool",
        params: z.object({}),
        run: async () => {
          throw new Error("sync exploded");
        },
      });
      const resolvedTools = new Map<string, ResolvedTool>([
        ["baseline_tool", { middleware: [], plugin: explodingPlugin }],
      ]);

      const [result] = await Effect.runPromise(
        executeApprovedSyncTools([toolCall], resolvedTools, minimalAgentDef, testConfig)
      );

      expect(result).toEqual({
        isError: true,
        result: JSON.stringify({ error: 'Plugin "baseline_tool" failed: sync exploded' }),
        toolName: "baseline_tool",
        toolUseId: "toolu_baseline",
      });
    });
  });
});
