import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import {
  type EmitFn,
  executeSyncTools,
  pluginDefToToolDef,
  startBackgroundTasks,
} from "../../src/agent/tool-executor";
import { TaskManager } from "../../src/background";
import { type InternalPlugin, PluginExecError } from "../../src/plugin";
import type { AgentEvent, ToolUseContent } from "../../src/types";
import { defaultAgentDef, defaultConfig, toResolvedTools } from "../utils/helpers";

function makePlugin(name: string, result: unknown): InternalPlugin {
  return {
    description: `mock ${name}`,
    execute: () => {
      if (
        result !== null &&
        typeof result === "object" &&
        "content" in result &&
        typeof (result as Record<string, unknown>).content === "string"
      ) {
        const r = result as { content: string; isError?: boolean };
        return Effect.succeed({ isError: r.isError, result: r.content });
      }
      return Effect.succeed({
        result: typeof result === "string" ? result : JSON.stringify(result),
      });
    },
    name,
    params: {},
  };
}

function makeFailingPlugin(name: string, error: string): InternalPlugin {
  return {
    description: `failing ${name}`,
    execute: () => Effect.fail(new PluginExecError(name, new Error(error))),
    name,
    params: {},
  };
}

function makeToolCall(
  name: string,
  input: Record<string, unknown> = {},
  id?: string
): ToolUseContent {
  return {
    input,
    name,
    toolUseId: id ?? `tu-${name}`,
    type: "tool_use",
  };
}

function captureEmit(): { emit: EmitFn; events: Array<AgentEvent> } {
  const events: Array<AgentEvent> = [];
  const emit: EmitFn = (event) => {
    events.push(event);
    return Effect.succeed(true);
  };
  return { emit, events };
}

describe("pluginDefToToolDef", () => {
  test("converts params to JSON Schema properties and required", () => {
    const def = {
      description: "Run a scan",
      name: "scan",
      params: {
        ports: { description: "port range", required: false, type: "string" },
        target: { description: "target host", required: true, type: "string" },
      },
    };

    const toolDef = pluginDefToToolDef(def);

    expect(toolDef.name).toBe("scan");
    expect(toolDef.description).toBe("Run a scan");
    expect(toolDef.inputSchema.type).toBe("object");
    expect(toolDef.inputSchema.properties).toEqual({
      ports: { description: "port range", type: "string" },
      target: { description: "target host", type: "string" },
    });
    expect(toolDef.inputSchema.required).toEqual(["target"]);
  });

  test("handles empty/undefined params", () => {
    const toolDef = pluginDefToToolDef({
      description: "No params",
      name: "noop",
    });

    expect(toolDef.inputSchema.properties).toEqual({});
    expect(toolDef.inputSchema.required).toEqual([]);
  });

  test("treats params without required field as required by default", () => {
    const toolDef = pluginDefToToolDef({
      description: "test",
      name: "test",
      params: {
        a: { type: "string" },
        b: { type: "number" },
      },
    });

    expect(toolDef.inputSchema.required).toEqual(["a", "b"]);
  });

  test("strips required from property definitions", () => {
    const toolDef = pluginDefToToolDef({
      description: "test",
      name: "test",
      params: {
        x: { description: "desc", required: true, type: "string" },
      },
    });

    expect(toolDef.inputSchema.properties.x).toEqual({
      description: "desc",
      type: "string",
    });
  });
});

describe("executeSyncTools", () => {
  test("executes single tool and returns result", async () => {
    const plugins = new Map<string, InternalPlugin>([
      ["echo", makePlugin("echo", { text: "hello" })],
    ]);
    const { emit, events } = captureEmit();
    const calls = [makeToolCall("echo", { text: "hello" })];

    const exit = await Effect.runPromiseExit(
      executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const results = exit.value;
      expect(results).toHaveLength(1);
      expect(results[0].toolName).toBe("echo");
      expect(JSON.parse(results[0].result)).toEqual({ text: "hello" });
    }

    const toolCallingEvents = events.filter((e) => e.type === "tool.call");
    expect(toolCallingEvents).toHaveLength(1);
  });

  test("returns error result for unknown tool (no crash)", async () => {
    const plugins = new Map<string, InternalPlugin>();
    const { emit } = captureEmit();
    const calls = [makeToolCall("nonexistent")];

    const exit = await Effect.runPromiseExit(
      executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const results = exit.value;
      expect(results).toHaveLength(1);
      const parsed = JSON.parse(results[0].result);
      expect(parsed.error).toContain("Tool not found: nonexistent");
    }
  });

  test("catches plugin error and returns error result", async () => {
    const plugins = new Map<string, InternalPlugin>([
      ["broken", makeFailingPlugin("broken", "plugin crashed")],
    ]);
    const { emit } = captureEmit();
    const calls = [makeToolCall("broken")];

    const exit = await Effect.runPromiseExit(
      executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const parsed = JSON.parse(exit.value[0].result);
      expect(parsed.error).toContain("plugin crashed");
    }
  });

  test("executes multiple tools in parallel", async () => {
    const plugins = new Map<string, InternalPlugin>([
      ["a", makePlugin("a", "result-a")],
      ["b", makePlugin("b", "result-b")],
      ["c", makePlugin("c", "result-c")],
    ]);
    const { emit, events } = captureEmit();
    const calls = [makeToolCall("a"), makeToolCall("b"), makeToolCall("c")];

    const exit = await Effect.runPromiseExit(
      executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const results = exit.value;
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.toolName).sort()).toEqual(["a", "b", "c"]);
    }

    expect(events.filter((e) => e.type === "tool.call")).toHaveLength(3);
  });

  test("handles non-object input gracefully", async () => {
    const plugins = new Map<string, InternalPlugin>([["test", makePlugin("test", "ok")]]);
    const { emit, events } = captureEmit();
    const call: ToolUseContent = {
      input: null as unknown as Record<string, unknown>,
      name: "test",
      toolUseId: "tu-1",
      type: "tool_use",
    };

    const exit = await Effect.runPromiseExit(
      executeSyncTools([call], toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    const calling = events.find((e) => e.type === "tool.call") as Extract<
      AgentEvent,
      { type: "tool.call" }
    >;
    expect(calling.args).toEqual({});
  });
});

describe("startBackgroundTasks", () => {
  test("starts task via TaskManager and returns taskId", async () => {
    const plugins = new Map<string, InternalPlugin>([
      ["scanner", makePlugin("scanner", "scan-done")],
    ]);
    const taskManager = new TaskManager();
    const { emit } = captureEmit();
    const calls = [makeToolCall("scanner", { target: "example.com" })];

    const exit = await Effect.runPromiseExit(
      startBackgroundTasks(calls, toResolvedTools(plugins), taskManager, emit)
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const results = exit.value;
      expect(results).toHaveLength(1);
      const parsed = JSON.parse(results[0].result);
      expect(parsed.taskId).toBeDefined();
      expect(typeof parsed.taskId).toBe("string");
      expect(parsed.taskId).toEqual(expect.any(String));
    }

    expect(taskManager.size).toBe(1);
  });

  test("emits bg.task.started event with taskId", async () => {
    const plugins = new Map<string, InternalPlugin>([["bg-tool", makePlugin("bg-tool", "result")]]);
    const taskManager = new TaskManager();
    const { emit, events } = captureEmit();
    const calls = [makeToolCall("bg-tool")];

    await Effect.runPromise(
      startBackgroundTasks(calls, toResolvedTools(plugins), taskManager, emit)
    );

    const startedEvents = events.filter((e) => e.type === "bg.task.started") as Array<
      Extract<AgentEvent, { type: "bg.task.started" }>
    >;
    expect(startedEvents).toHaveLength(1);
    expect(startedEvents[0].toolName).toBe("bg-tool");
    expect(startedEvents[0].taskId).toEqual(expect.any(String));
  });

  test("returns error for unknown tool (no TaskManager call)", async () => {
    const plugins = new Map<string, InternalPlugin>();
    const taskManager = new TaskManager();
    const { emit, events } = captureEmit();
    const calls = [makeToolCall("missing-tool")];

    const exit = await Effect.runPromiseExit(
      startBackgroundTasks(calls, toResolvedTools(plugins), taskManager, emit)
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const parsed = JSON.parse(exit.value[0].result);
      expect(parsed.error).toContain("Tool not found: missing-tool");
    }

    expect(taskManager.size).toBe(0);

    const startedEvents = events.filter((e) => e.type === "bg.task.started");
    expect(startedEvents).toHaveLength(0);
  });

  test("handles multiple background tasks", async () => {
    const plugins = new Map<string, InternalPlugin>([
      ["t1", makePlugin("t1", "r1")],
      ["t2", makePlugin("t2", "r2")],
    ]);
    const taskManager = new TaskManager();
    const { emit, events } = captureEmit();
    const calls = [makeToolCall("t1"), makeToolCall("t2")];

    const exit = await Effect.runPromiseExit(
      startBackgroundTasks(calls, toResolvedTools(plugins), taskManager, emit)
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(2);
      for (const r of exit.value) {
        const parsed = JSON.parse(r.result);
        expect(parsed.taskId).toEqual(expect.any(String));
      }
    }

    expect(taskManager.size).toBe(2);

    const startedEvents = events.filter((e) => e.type === "bg.task.started");
    expect(startedEvents).toHaveLength(2);
  });
});
