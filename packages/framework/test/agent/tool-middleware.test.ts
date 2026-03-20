import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import { type ResolvedTool, setupPlugins } from "../../src/agent/setup";
import { executeApprovedSyncTools } from "../../src/agent/sync-execution";
import { plugin } from "../../src/plugin";
import type { AgentDef, ToolResult } from "../../src/types";
import { defaultConfig } from "../utils/helpers";

function makeCall(name: string, input: Record<string, unknown> = {}, toolUseId = `tu-${name}`) {
  return { input, name, toolUseId, type: "tool_use" as const };
}

function makeAgentDef(overrides: Partial<AgentDef> = {}): AgentDef {
  return {
    name: "middleware-test-agent",
    prompt: "test",
    tools: [],
    ...overrides,
  };
}

async function runApproved(
  calls: Array<ReturnType<typeof makeCall>>,
  resolvedTools: Map<string, ResolvedTool>,
  agentDef: AgentDef
) {
  return Effect.runPromise(executeApprovedSyncTools(calls, resolvedTools, agentDef, defaultConfig));
}

describe("tool middleware", () => {
  test("ordering: global-before → local-before → tool → local-after → global-after", async () => {
    const callOrder: Array<string> = [];
    const echo = plugin({
      description: "echo",
      name: "echo",
      params: z.object({}),
      run: async () => {
        callOrder.push("tool");
        return "ok";
      },
    });

    const resolvedTools = new Map<string, ResolvedTool>([
      [
        "echo",
        {
          middleware: [
            async (_ctx, next) => {
              callOrder.push("local-before");
              const result = await next();
              callOrder.push("local-after");
              return result;
            },
          ],
          plugin: echo,
        },
      ],
    ]);

    const agentDef = makeAgentDef({
      toolMiddleware: [
        async (_ctx, next) => {
          callOrder.push("global-before");
          const result = await next();
          callOrder.push("global-after");
          return result;
        },
      ],
    });

    const [result] = await runApproved([makeCall("echo")], resolvedTools, agentDef);

    expect(result.result).toBe("ok");
    expect(callOrder).toEqual([
      "global-before",
      "local-before",
      "tool",
      "local-after",
      "global-after",
    ]);
  });

  test("short-circuit: middleware returns result without next and tool never runs", async () => {
    let ranTool = false;
    const echo = plugin({
      description: "echo",
      name: "echo",
      params: z.object({}),
      run: async () => {
        ranTool = true;
        return "tool";
      },
    });

    const resolvedTools = new Map<string, ResolvedTool>([
      [
        "echo",
        {
          middleware: [async () => ({ content: "cached" })],
          plugin: echo,
        },
      ],
    ]);

    const [result] = await runApproved([makeCall("echo")], resolvedTools, makeAgentDef());

    expect(ranTool).toBe(false);
    expect(result.isError).toBe(false);
    expect(result.result).toBe("cached");
  });

  test("result rewrite: middleware transforms result after next", async () => {
    const echo = plugin({
      description: "echo",
      name: "echo",
      params: z.object({}),
      run: async () => "base",
    });

    const resolvedTools = new Map<string, ResolvedTool>([
      [
        "echo",
        {
          middleware: [
            async (_ctx, next) => {
              const result = await next();
              return { ...result, content: `${result.content}:rewritten` };
            },
          ],
          plugin: echo,
        },
      ],
    ]);

    const [result] = await runApproved([makeCall("echo")], resolvedTools, makeAgentDef());

    expect(result.result).toBe("base:rewritten");
  });

  test("input rewrite: middleware mutates input and rewritten input is revalidated", async () => {
    let ranTool = false;
    const counter = plugin({
      description: "counter",
      name: "counter",
      params: z.object({ count: z.number() }),
      run: async ({ count }) => {
        ranTool = true;
        return String(count);
      },
    });

    const resolvedTools = new Map<string, ResolvedTool>([
      [
        "counter",
        {
          middleware: [
            async (ctx, next) => {
              ctx.toolInput = { count: "bad" };
              return next();
            },
          ],
          plugin: counter,
        },
      ],
    ]);

    const [result] = await runApproved(
      [makeCall("counter", { count: 1 })],
      resolvedTools,
      makeAgentDef()
    );

    expect(ranTool).toBe(false);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.result).error).toContain('Param "count" expected type "number"');
  });

  test("middleware throw: runtime normalizes thrown middleware error", async () => {
    const echo = plugin({
      description: "echo",
      name: "echo",
      params: z.object({}),
      run: async () => "ok",
    });

    const resolvedTools = new Map<string, ResolvedTool>([
      [
        "echo",
        {
          middleware: [
            async () => {
              throw new Error("middleware exploded");
            },
          ],
          plugin: echo,
        },
      ],
    ]);

    const [result] = await runApproved([makeCall("echo")], resolvedTools, makeAgentDef());

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.result).error).toContain("middleware exploded");
  });

  test("double-next: calling next twice returns normalized error", async () => {
    const echo = plugin({
      description: "echo",
      name: "echo",
      params: z.object({}),
      run: async () => "ok",
    });

    const resolvedTools = new Map<string, ResolvedTool>([
      [
        "echo",
        {
          middleware: [
            async (_ctx, next) => {
              await next();
              return next();
            },
          ],
          plugin: echo,
        },
      ],
    ]);

    const [result] = await runApproved([makeCall("echo")], resolvedTools, makeAgentDef());

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.result).error).toContain("next() called more than once");
  });

  test("mixed-form API: plain tool and { tool, middleware } binding both work", async () => {
    const plain = {
      description: "plain",
      name: "plain",
      params: z.object({}),
      run: async () => "plain-result",
    };
    const bound = {
      description: "bound",
      name: "bound",
      params: z.object({}),
      run: async () => "bound-result",
    };

    const agentDef = makeAgentDef({
      tools: [
        plain,
        {
          middleware: [
            async (_ctx, next) => {
              const result = await next();
              return { ...result, content: `${result.content}:local` };
            },
          ],
          tool: bound,
        },
      ],
    });
    const { resolvedTools } = setupPlugins(agentDef);
    const results = await runApproved(
      [makeCall("plain"), makeCall("bound")],
      resolvedTools,
      agentDef
    );

    expect(results.find((result) => result.toolName === "plain")?.result).toBe("plain-result");
    expect(results.find((result) => result.toolName === "bound")?.result).toBe(
      "bound-result:local"
    );
  });

  test("global vs local: global middleware applies to all tools, local only to bound tool", async () => {
    const seen: Array<string> = [];
    const mkTool = (name: string) => ({
      description: name,
      name,
      params: z.object({}),
      run: async () => name,
    });

    const globalMiddleware = async (ctx: { toolName: string }, next: () => Promise<ToolResult>) => {
      seen.push(`global:${ctx.toolName}`);
      const result = await next();
      return { ...result, content: `${result.content}:global` };
    };

    const agentDef = makeAgentDef({
      toolMiddleware: [globalMiddleware],
      tools: [
        mkTool("plain"),
        {
          middleware: [
            async (_ctx, next) => {
              seen.push("local:bound");
              const result = await next();
              return { ...result, content: `${result.content}:local` };
            },
          ],
          tool: mkTool("bound"),
        },
      ],
    });
    const { resolvedTools } = setupPlugins(agentDef);
    const results = await runApproved(
      [makeCall("plain"), makeCall("bound")],
      resolvedTools,
      agentDef
    );

    expect(seen).toEqual(["global:plain", "global:bound", "local:bound"]);
    expect(results.find((result) => result.toolName === "plain")?.result).toBe("plain:global");
    expect(results.find((result) => result.toolName === "bound")?.result).toBe(
      "bound:local:global"
    );
  });
});
