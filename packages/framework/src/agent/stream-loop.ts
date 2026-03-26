import { Effect } from "effect";
import { parseJson } from "../parse-contract";
import { instrumentLLMCall } from "../telemetry/instrument";
import { addSpanAttributes } from "../telemetry/tracer";
import type { ContentBlock, LLMResponse, TextContent, ToolUseContent } from "../types";
import { BlockType } from "../types/constants";
import type { LLMStreamEvent } from "../types/llm";
import { normalizeStopReason } from "../utils";
import type { LLMCallStrategy } from "./agent-loop/index";
import { createParseErrorEvent, createToolUseContent, isToolInputRecord } from "./tool-call-shared";

type EmitFn = Parameters<LLMCallStrategy>[4];

interface StreamState {
  content: Array<ContentBlock>;
  currentTool: { input: string; name: string; toolUseId: string } | undefined;
  stopReason: LLMResponse["stopReason"];
  usage: { inputTokens: number; outputTokens: number };
}

function isTextContent(b: ContentBlock): b is TextContent {
  return b.type === BlockType.TEXT;
}

function appendText(content: Array<ContentBlock>, delta: string) {
  const last = content.at(-1);
  if (last && isTextContent(last)) {
    last.text += delta;
  } else {
    content.push({ text: delta, type: BlockType.TEXT });
  }
}

function handleToolUseStart(
  event: Extract<LLMStreamEvent, { type: "tool_use_start" }>,
  state: StreamState
): void {
  state.currentTool = {
    input: "",
    name: event.name,
    toolUseId: event.toolUseId,
  };
}

function handleToolUseDelta(
  event: Extract<LLMStreamEvent, { type: "tool_use_delta" }>,
  state: StreamState
): void {
  if (state.currentTool) {
    state.currentTool.input += event.input;
  }
}

function parseToolUseContent(
  tool: NonNullable<StreamState["currentTool"]>
):
  | { ok: true; value: ToolUseContent }
  | { event: ReturnType<typeof createParseErrorEvent>; ok: false } {
  let parsed: Record<string, unknown> = {};

  if (tool.input) {
    const result = parseJson(tool.input);
    if (!result.ok) {
      return {
        event: createParseErrorEvent({
          error: result.error,
          rawInput: tool.input,
          toolName: tool.name,
          toolUseId: tool.toolUseId,
        }),
        ok: false,
      };
    }

    if (!isToolInputRecord(result.value)) {
      return {
        event: createParseErrorEvent({
          error: "Expected streamed tool input JSON object",
          rawInput: tool.input,
          toolName: tool.name,
          toolUseId: tool.toolUseId,
        }),
        ok: false,
      };
    }

    parsed = result.value;
  }

  return {
    ok: true,
    value: createToolUseContent(tool.name, tool.toolUseId, parsed),
  };
}

async function finalizeToolUseContent(state: StreamState, emit: EmitFn): Promise<void> {
  const tool = state.currentTool;
  if (!tool) {
    return;
  }

  const finalized = parseToolUseContent(tool);
  state.currentTool = undefined;

  if (!finalized.ok) {
    await Effect.runPromise(emit(finalized.event));
    return;
  }

  state.content.push(finalized.value);
}

async function handleToolUseEnd(
  _event: Extract<LLMStreamEvent, { type: "tool_use_end" }>,
  state: StreamState,
  emit: EmitFn
): Promise<void> {
  await finalizeToolUseContent(state, emit);
}

function handleContentDelta(
  event: Extract<LLMStreamEvent, { type: "text_delta" }>,
  state: StreamState,
  emit: EmitFn
): void {
  appendText(state.content, event.content);
  Effect.runPromise(
    emit({
      content: event.content,
      phase: "executing",
      timestamp: Date.now(),
      type: "stream.chunk",
    })
  ).catch((e) => {
    process.stderr.write(`[stream] emit error: ${String(e)}\n`);
  });
}

function handleStreamEnd(
  event: Extract<LLMStreamEvent, { type: "message_end" }>,
  state: StreamState
): void {
  state.stopReason = normalizeStopReason(event.stopReason);
  state.usage = {
    inputTokens: event.usage.inputTokens,
    outputTokens: event.usage.outputTokens,
  };
}

export const streamingStrategy: LLMCallStrategy = (
  provider,
  messages,
  toolDefs,
  telemetryConfig,
  emit
) =>
  Effect.tryPromise({
    catch: (error) => error,
    try: () =>
      instrumentLLMCall(telemetryConfig, "unknown", "unknown", async () => {
        const state: StreamState = {
          content: [],
          currentTool: undefined,
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 },
        };

        const stream = provider.chatStream(messages, toolDefs.length > 0 ? toolDefs : undefined);

        for await (const event of stream) {
          if (event.type === "text_delta") {
            handleContentDelta(event, state, emit);
            continue;
          }
          if (event.type === "tool_use_start") {
            handleToolUseStart(event, state);
            continue;
          }
          if (event.type === "tool_use_delta") {
            handleToolUseDelta(event, state);
            continue;
          }
          if (event.type === "tool_use_end") {
            await handleToolUseEnd(event, state, emit);
            continue;
          }
          if (event.type === "message_end") {
            handleStreamEnd(event, state);
          }
        }

        addSpanAttributes(telemetryConfig, {
          "gen_ai.usage.input_tokens": state.usage.inputTokens,
          "gen_ai.usage.output_tokens": state.usage.outputTokens,
        });

        return {
          content: state.content,
          stopReason: state.stopReason,
          usage: state.usage,
        };
      }),
  });
