import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { z } from "zod";
import { buildToolResultMessages } from "../../src/agent/message-builder";
import type { EmitFn } from "../../src/agent/tool-executor";
import { executeSyncTools } from "../../src/agent/tool-executor";
import { buildBackgroundPlugin, buildGetResultPlugin, TaskManager } from "../../src/background";
import type { InternalPlugin } from "../../src/plugin";
import { plugin } from "../../src/plugin";
import type { AgentEvent, PluginDef, ToolUseContent } from "../../src/types";
import { defaultAgentDef, defaultConfig, toResolvedTools } from "../utils/helpers";

function makeCall(name: string, id = `tu-${name}`): ToolUseContent {
  return { input: {}, name, toolUseId: id, type: "tool_use" };
}

function captureEmit(): { emit: EmitFn; events: Array<AgentEvent> } {
  const events: Array<AgentEvent> = [];
  return {
    emit: (e) => {
      events.push(e);
      return Effect.succeed(true);
    },
    events,
  };
}

async function runSync(
  pluginInst: InternalPlugin,
  callId = "tu-1"
): Promise<{ isError: boolean; result: string; toolName: string; toolUseId: string }> {
  const plugins = new Map<string, InternalPlugin>([[pluginInst.name, pluginInst]]);
  const { emit } = captureEmit();
  const exit = await Effect.runPromiseExit(
    executeSyncTools(
      [makeCall(pluginInst.name, callId)],
      toResolvedTools(plugins),
      defaultAgentDef,
      defaultConfig,
      emit
    )
  );
  if (!Exit.isSuccess(exit)) {
    throw new Error("executeSyncTools failed");
  }
  return exit.value[0] as { isError: boolean; result: string; toolName: string; toolUseId: string };
}

async function runGetResult(
  innerDef: PluginDef,
  waitMs = 30
): Promise<{ isError: boolean; result: string }> {
  const taskManager = new TaskManager();
  const bgWrapped = buildBackgroundPlugin(innerDef, taskManager);
  const bgPlugin = plugin(bgWrapped);

  const bgPlugins = new Map<string, InternalPlugin>([[bgWrapped.name, bgPlugin]]);
  const { emit: emit1 } = captureEmit();
  const bgExit = await Effect.runPromiseExit(
    executeSyncTools(
      [makeCall(bgWrapped.name, "tu-bg")],
      toResolvedTools(bgPlugins),
      defaultAgentDef,
      defaultConfig,
      emit1
    )
  );
  if (!Exit.isSuccess(bgExit)) {
    throw new Error("bg start failed");
  }
  const { taskId } = JSON.parse(bgExit.value[0].result) as { taskId: string };

  await new Promise((r) => setTimeout(r, waitMs));

  const getResultInternal = plugin(buildGetResultPlugin(taskManager));
  const grPlugins = new Map<string, InternalPlugin>([["get_result", getResultInternal]]);
  const { emit: emit2 } = captureEmit();
  const grExit = await Effect.runPromiseExit(
    executeSyncTools(
      [{ input: { taskId }, name: "get_result", toolUseId: "tu-gr", type: "tool_use" }],
      toResolvedTools(grPlugins),
      defaultAgentDef,
      defaultConfig,
      emit2
    )
  );
  if (!Exit.isSuccess(grExit)) {
    throw new Error("get_result failed");
  }
  return grExit.value[0] as { isError: boolean; result: string };
}

describe("A: Sync path envelope shapes", () => {
  test("A1: plain string → result=string, isError=false", async () => {
    const p = plugin({
      description: "d",
      name: "p-string",
      params: z.object({}),
      run: async () => "hello world",
    });
    const r = await runSync(p);
    expect(r.result).toBe("hello world");
    expect(r.isError).toBe(false);
  });

  test("A2: plain object → result=JSON.stringify(obj), isError=false", async () => {
    const p = plugin({
      description: "d",
      name: "p-object",
      params: z.object({}),
      run: async () => ({ ports: [22, 80], target: "x.com" }),
    });
    const r = await runSync(p);
    expect(r.result).toBe(JSON.stringify({ ports: [22, 80], target: "x.com" }));
    expect(r.isError).toBe(false);
  });

  test("A3: ToolOutput{content, isError:true} → result=content, isError=true", async () => {
    const p = plugin({
      description: "d",
      name: "p-tooloutput-err",
      params: z.object({}),
      run: async () => ({ content: "scan failed", isError: true }),
    });
    const r = await runSync(p);
    expect(r.result).toBe("scan failed");
    expect(r.isError).toBe(true);
  });

  test("A4: ToolOutput{content, isError:false} → result=content, isError=false", async () => {
    const p = plugin({
      description: "d",
      name: "p-tooloutput-ok",
      params: z.object({}),
      run: async () => ({ content: "scan done", isError: false }),
    });
    const r = await runSync(p);
    expect(r.result).toBe("scan done");
    expect(r.isError).toBe(false);
  });

  test("A5: ToolOutput{content} no isError → isError=false", async () => {
    const p = plugin({
      description: "d",
      name: "p-tooloutput-noerr",
      params: z.object({}),
      run: async () => ({ content: "neutral result" }) as { content: string },
    });
    const r = await runSync(p);
    expect(r.result).toBe("neutral result");
    expect(r.isError).toBe(false);
  });

  test("A6: thrown error → result=JSON({error}), isError=true", async () => {
    const p = plugin({
      description: "d",
      name: "p-throw",
      params: z.object({}),
      run: async () => {
        throw new Error("exploded");
      },
    });
    const r = await runSync(p);
    const parsed = JSON.parse(r.result) as { error: string };
    expect(parsed.error).toContain("exploded");
    expect(r.isError).toBe(true);
  });

  test("A7: tool not found → result=JSON({error}), isError=true", async () => {
    const plugins = new Map<string, InternalPlugin>();
    const { emit } = captureEmit();
    const exit = await Effect.runPromiseExit(
      executeSyncTools(
        [makeCall("missing", "tu-m")],
        toResolvedTools(plugins),
        defaultAgentDef,
        defaultConfig,
        emit
      )
    );
    if (!Exit.isSuccess(exit)) {
      throw new Error("should succeed");
    }
    const r = exit.value[0];
    const parsed = JSON.parse(r.result) as { error: string };
    expect(parsed.error).toContain("Tool not found: missing");
    expect(r.isError).toBe(true);
  });

  test("A8: async iterable → result=JSON(lastYieldedValue), isError=false", async () => {
    const p = plugin({
      description: "d",
      name: "p-iter",
      params: z.object({}),
      run: async function* () {
        yield "chunk1";
        yield { final: true };
      },
    });
    const r = await runSync(p);
    expect(r.result).toBe(JSON.stringify({ final: true }));
    expect(r.isError).toBe(false);
  });
});

describe("B: Background launch envelope", () => {
  test("B1: launch returns {taskId} JSON immediately, isError=false", async () => {
    const taskManager = new TaskManager();
    const innerDef: PluginDef = {
      description: "d",
      name: "slow",
      params: z.object({}),
      run: async () => "bg-result",
    };
    const bgWrapped = buildBackgroundPlugin(innerDef, taskManager);
    const bgPlugin = plugin(bgWrapped);
    const plugins = new Map<string, InternalPlugin>([["slow", bgPlugin]]);
    const { emit } = captureEmit();
    const exit = await Effect.runPromiseExit(
      executeSyncTools(
        [makeCall("slow", "tu-slow")],
        toResolvedTools(plugins),
        defaultAgentDef,
        defaultConfig,
        emit
      )
    );
    if (!Exit.isSuccess(exit)) {
      throw new Error("should succeed");
    }
    const r = exit.value[0];
    const parsed = JSON.parse(r.result) as { taskId: string };
    expect(parsed.taskId).toMatch(/^task-/);
    expect(r.isError).toBe(false);
    expect(r.toolName).toBe("slow");
  });
});

describe("C: get_result envelope shapes", () => {
  test("C1: string result → {success:true, data:string, status:completed}", async () => {
    const innerDef: PluginDef = {
      description: "d",
      name: "inner",
      params: z.object({}),
      run: async () => "plain-string-output",
    };
    const r = await runGetResult(innerDef);
    const parsed = JSON.parse(r.result) as { data: string; status: string; success: boolean };
    expect(parsed.status).toBe("completed");
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe("plain-string-output");
    expect(r.isError).toBe(false);
  });

  test("C2: object result → {success:true, data:parsedObj, status:completed}", async () => {
    const innerDef: PluginDef = {
      description: "d",
      name: "inner",
      params: z.object({}),
      run: async () => ({ host: "10.0.0.1", ports: [22, 443] }),
    };
    const r = await runGetResult(innerDef);
    const parsed = JSON.parse(r.result) as {
      data: { host: string; ports: Array<number> };
      status: string;
      success: boolean;
    };
    expect(parsed.status).toBe("completed");
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ host: "10.0.0.1", ports: [22, 443] });
  });

  test("C3: non-JSON string → raw string preserved in data field", async () => {
    const innerDef: PluginDef = {
      description: "d",
      name: "inner",
      params: z.object({}),
      run: async () => "non-json raw output",
    };
    const r = await runGetResult(innerDef);
    const parsed = JSON.parse(r.result) as { data: string; status: string; success: boolean };
    expect(parsed.status).toBe("completed");
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe("non-json raw output");
    expect(r.isError).toBe(false);
  });

  test("C4: task error via asBackground(wait=undef) → {success:false, error, status:failed}", async () => {
    const innerDef: PluginDef = {
      description: "d",
      name: "inner",
      params: z.object({}),
      run: async () => {
        throw new Error("task-failed");
      },
    };
    const r = await runGetResult(innerDef);
    const parsed = JSON.parse(r.result) as {
      data: null;
      error: string;
      status: string;
      success: boolean;
    };
    expect(parsed.status).toBe("failed");
    expect(parsed.success).toBe(false);
    expect(parsed.data).toBeNull();
    expect(typeof parsed.error).toBe("string");
  });

  test("C5: task not found → {success:false, error, status:not_found}", async () => {
    const taskManager = new TaskManager();
    const getResultInternal = plugin(buildGetResultPlugin(taskManager));
    const grPlugins = new Map<string, InternalPlugin>([["get_result", getResultInternal]]);
    const { emit } = captureEmit();
    const exit = await Effect.runPromiseExit(
      executeSyncTools(
        [
          {
            input: { taskId: "task-does-not-exist" },
            name: "get_result",
            toolUseId: "tu-nf",
            type: "tool_use",
          },
        ],
        toResolvedTools(grPlugins),
        defaultAgentDef,
        defaultConfig,
        emit
      )
    );
    if (!Exit.isSuccess(exit)) {
      throw new Error("should succeed");
    }
    const r = exit.value[0];
    const parsed = JSON.parse(r.result) as {
      data: null;
      error: string;
      status: string;
      success: boolean;
    };
    expect(parsed.status).toBe("not_found");
    expect(parsed.success).toBe(false);
    expect(parsed.data).toBeNull();
    expect(parsed.error).toContain("task-does-not-exist");
    expect(r.isError).toBe(true);
  });

  test("C6: task still running → {success:false, startedAt, status:running}", async () => {
    const taskManager = new TaskManager();
    const innerDef: PluginDef = {
      description: "d",
      name: "inner",
      params: z.object({}),
      run: async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return "never";
      },
    };
    const bgWrapped = buildBackgroundPlugin(innerDef, taskManager);
    const bgPlugin = plugin(bgWrapped);
    const bgPlugins = new Map<string, InternalPlugin>([["inner", bgPlugin]]);
    const { emit: emit1 } = captureEmit();
    const bgExit = await Effect.runPromiseExit(
      executeSyncTools(
        [makeCall("inner", "tu-1")],
        toResolvedTools(bgPlugins),
        defaultAgentDef,
        defaultConfig,
        emit1
      )
    );
    if (!Exit.isSuccess(bgExit)) {
      throw new Error("bg start failed");
    }
    const { taskId } = JSON.parse(bgExit.value[0].result) as { taskId: string };

    const getResultInternal = plugin(buildGetResultPlugin(taskManager));
    const grPlugins = new Map<string, InternalPlugin>([["get_result", getResultInternal]]);
    const { emit: emit2 } = captureEmit();
    const grExit = await Effect.runPromiseExit(
      executeSyncTools(
        [{ input: { taskId }, name: "get_result", toolUseId: "tu-gr", type: "tool_use" }],
        toResolvedTools(grPlugins),
        defaultAgentDef,
        defaultConfig,
        emit2
      )
    );
    if (!Exit.isSuccess(grExit)) {
      throw new Error("get_result failed");
    }
    const r = grExit.value[0];
    const parsed = JSON.parse(r.result) as {
      data: null;
      error: null;
      startedAt: number;
      status: string;
      success: boolean;
    };
    expect(parsed.success).toBe(false);
    expect(parsed.data).toBeNull();
    expect(parsed.error).toBeNull();
    expect(parsed.status).toBe("running");
    expect(typeof parsed.startedAt).toBe("number");
  });
});

describe("D: framework tool_result message shape", () => {
  test("D1: successful tool output becomes tool_result with success status", () => {
    const messages = buildToolResultMessages([
      { isError: false, result: '{"key":"value"}', toolUseId: "tu-1" },
    ]);

    expect(messages).toEqual([
      {
        content: [
          {
            content: '{"key":"value"}',
            status: "success",
            toolUseId: "tu-1",
            type: "tool_result",
          },
        ],
        role: "user",
      },
    ]);
  });

  test("D2: failed tool output becomes tool_result with error status", () => {
    const messages = buildToolResultMessages([
      { isError: true, result: '{"error":"bad"}', toolUseId: "tu-2" },
    ]);

    expect(messages).toEqual([
      {
        content: [
          {
            content: '{"error":"bad"}',
            status: "error",
            toolUseId: "tu-2",
            type: "tool_result",
          },
        ],
        role: "user",
      },
    ]);
  });
});

describe("E: canonical parse/result helpers", () => {
  test("E1: safeJsonParse on valid JSON → success envelope with parsed object", async () => {
    const { safeJsonParse } = await import("../../src/utils");
    expect(safeJsonParse('{"key":"v","num":42}')).toEqual({
      data: { key: "v", num: 42 },
      error: undefined,
      success: true,
    });
  });

  test("E2: safeJsonParse on non-JSON → failure envelope with raw string", async () => {
    const { safeJsonParse } = await import("../../src/utils");
    expect(safeJsonParse("plain text")).toEqual({
      data: "plain text",
      error: expect.stringContaining("Unexpected identifier"),
      success: false,
    });
  });

  test("E3: toToolResultEnvelope on valid JSON result → success envelope with parsed data", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    expect(toToolResultEnvelope({ result: '{"ports":[80]}' })).toEqual({
      data: { ports: [80] },
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("E4: toToolResultEnvelope on invalid JSON result → success envelope with raw string", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    expect(toToolResultEnvelope({ result: "plain text" })).toEqual({
      data: "plain text",
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("E5: toToolResultEnvelope on failed result → failed envelope", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    expect(toToolResultEnvelope({ isError: true, result: '{"error":"boom"}' })).toEqual({
      data: null,
      error: "boom",
      status: "completed",
      success: false,
    });
  });

  test("E6: toToolResultEnvelope on null → fallback with null data", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    expect(toToolResultEnvelope(null)).toEqual({
      data: null,
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("E7: toToolResultEnvelope on undefined → fallback with undefined data", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    expect(toToolResultEnvelope(undefined)).toEqual({
      data: undefined,
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("E8: toToolResultEnvelope on primitive number → fallback passthrough", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    expect(toToolResultEnvelope(42)).toEqual({
      data: 42,
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("E9: toToolResultEnvelope on plain object → fallback passthrough", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    const obj = { count: 5, foo: "bar" };
    expect(toToolResultEnvelope(obj)).toEqual({
      data: obj,
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("E10: toToolResultEnvelope on {error: string} → failed envelope", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    expect(toToolResultEnvelope({ error: "failure message" })).toEqual({
      data: null,
      error: "failure message",
      status: "completed",
      success: false,
    });
  });

  test("E11: toToolResultEnvelope on {error: object} → passthrough as data (error must be string)", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    const obj = { error: { code: 500, msg: "server error" } };
    expect(toToolResultEnvelope(obj)).toEqual({
      data: obj,
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("E12: toToolResultEnvelope on success=false with status timeout", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    expect(toToolResultEnvelope({ error: "timed out", status: "timeout", success: false })).toEqual(
      {
        data: null,
        error: "timed out",
        status: "timeout",
        success: false,
      }
    );
  });

  test("E13: toToolResultEnvelope on success=false without error → unknown error", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    expect(toToolResultEnvelope({ success: false })).toEqual({
      data: null,
      error: "Unknown error",
      status: "completed",
      success: false,
    });
  });

  test("E14: toToolResultEnvelope on running envelope → preserves running state", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    const running = {
      data: null,
      error: null,
      startedAt: 12_345,
      status: "running",
      success: false,
    } as const;
    expect(toToolResultEnvelope(running)).toEqual(running);
  });

  test("E15: toToolResultEnvelope on wrapped envelope → unwraps inner envelope", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    const inner = {
      data: { result: "nested" },
      error: null,
      status: "completed" as const,
      success: true as const,
    };
    const wrapped = { result: JSON.stringify(inner) };
    expect(toToolResultEnvelope(wrapped)).toEqual(inner);
  });

  test("E16: toToolResultEnvelope on error with invalid JSON result → uses raw string", async () => {
    const { toToolResultEnvelope } = await import("../../src/utils");
    expect(toToolResultEnvelope({ isError: true, result: "not valid json {" })).toEqual({
      data: null,
      error: "not valid json {",
      status: "completed",
      success: false,
    });
  });
});
