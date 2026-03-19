import { Effect } from "effect";
import type { ResolvedTool } from "../../src/agent/setup";
import type { EmitFn } from "../../src/agent/tool-executor";
import type { InternalPlugin } from "../../src/plugin";
import type { ObskuConfig } from "../../src/services/config";
import type {
  AgentDef,
  AgentEvent,
  LLMProvider,
  LLMResponse,
  Message,
  ToolDef,
} from "../../src/types";

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const dummyStream = async function* () {
  yield { content: "", type: "text_delta" as const };
};

export const defaultConfig: ObskuConfig = {
  maxIterations: 10,
  toolConcurrency: 3,
  toolTimeout: 30_000,
};

export const defaultAgentDef: AgentDef = {
  name: "test-agent",
  prompt: "test",
  tools: [],
};

export function makeEmit(captured: Array<AgentEvent>): EmitFn {
  return (event: AgentEvent) =>
    Effect.sync(() => {
      captured.push(event);
      return true;
    });
}

export type MockPluginResult =
  | string
  | { content: string; isError?: boolean }
  | null
  | Record<string, unknown>;

export function makePlugin(name: string, result: MockPluginResult = "ok"): InternalPlugin {
  return {
    description: `mock ${name}`,
    execute: (_input) => {
      if (
        result !== null &&
        typeof result === "object" &&
        "content" in result &&
        typeof (result as { content: unknown }).content === "string"
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

export function toResolvedTools(
  tools: Map<string, InternalPlugin> | Map<string, ResolvedTool>
): Map<string, ResolvedTool> {
  const resolvedTools = new Map<string, ResolvedTool>();

  for (const [name, tool] of tools as Iterable<[string, InternalPlugin | ResolvedTool]>) {
    if ("plugin" in tool && "middleware" in tool) {
      resolvedTools.set(name, tool);
    } else {
      resolvedTools.set(name, { middleware: [], plugin: tool });
    }
  }

  return resolvedTools;
}

export function makeProvider(
  chatFn: (msgs: Array<Message>, tools?: Array<ToolDef>) => Promise<LLMResponse>
): LLMProvider {
  return { chat: chatFn, chatStream: dummyStream, contextWindowSize: 200_000 };
}

// ---------------------------------------------------------------------------
// Shared Mock Providers for Graph Tests
// ---------------------------------------------------------------------------

/** Minimal mock provider that returns a simple "ok" response.
 *  Used for graph structure tests where LLM behavior doesn't matter.
 */
export const minimalMockProvider: LLMProvider = {
  chat: async () => ({
    content: [{ text: "ok", type: "text" as const }],
    stopReason: "end_turn" as const,
    usage: { inputTokens: 0, outputTokens: 0 },
  }),
  chatStream: async function* () {},
  contextWindowSize: 200_000,
};

/** Creates an echo mock provider that returns user input back.
 *  Optionally maps specific inputs to predefined responses.
 */
export function createEchoMockProvider(responses?: Record<string, string>): LLMProvider {
  return {
    chat: async (messages) => {
      const userText = messages
        .filter((m) => m.role === "user")
        .flatMap((m) => m.content)
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string; type: "text" }).text)
        .join("");

      const responseText = responses ? (Object.values(responses).shift() ?? userText) : userText;

      return {
        content: [{ text: responseText, type: "text" as const }],
        stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 10 },
      } satisfies LLMResponse;
    },
    chatStream: async function* () {},
    contextWindowSize: 200_000,
  };
}

// ---------------------------------------------------------------------------
// Shared Graph Test Helpers
// ---------------------------------------------------------------------------

import type { GraphEdge, GraphNode } from "../../src/graph/types";

export function makeNode(id: string): GraphNode {
  return {
    description: `Node ${id}`,
    executor: { name: `agent-${id}`, prompt: `Do ${id}` },
    id,
  };
}

export function makeEdge(from: string, to: string, overrides?: Partial<GraphEdge>): GraphEdge {
  return { from, to, ...overrides };
}

export function agentNode(id: string): GraphNode {
  return {
    executor: { name: `agent-${id}`, prompt: `Execute ${id}` },
    id,
  };
}

export function fnNode(id: string, fn: (input: unknown) => Promise<unknown>): GraphNode {
  return { executor: fn, id };
}

export function edge(from: string, to: string): GraphEdge {
  return { from, to };
}
