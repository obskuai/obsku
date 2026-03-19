import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type {
  LLMProvider,
  LLMResponse,
  Message,
  ResponseFormat,
  TelemetryConfig,
  ToolDef,
} from "../types";
import { ProviderError } from "../types/provider-error";
import { getErrorMessage } from "../utils";
import { isRecord } from "../utils/type-guards";
import type { EmitFn } from "./tool-executor";

function isValidLLMResponse(response: unknown): response is LLMResponse {
  return (
    isRecord(response) &&
    (response.role === undefined || typeof response.role === "string") &&
    Array.isArray(response.content) &&
    typeof response.stopReason === "string" &&
    isRecord(response.usage) &&
    typeof response.usage.inputTokens === "number" &&
    typeof response.usage.outputTokens === "number"
  );
}

function describeResponseShape(response: unknown): string {
  if (!isRecord(response)) {
    return Array.isArray(response) ? "array" : String(response);
  }

  return JSON.stringify(
    Object.fromEntries(
      Object.entries(response).map(([key, value]) => [
        key,
        Array.isArray(value) ? "array" : typeof value,
      ])
    )
  );
}

export type LLMCallStrategy = (
  provider: LLMProvider,
  messages: Array<Message>,
  toolDefs: Array<ToolDef>,
  telemetryConfig: TelemetryConfig | undefined,
  emit: EmitFn,
  responseFormat?: ResponseFormat
) => Effect.Effect<LLMResponse, unknown>;

export function callLLMWithEvents(
  strategy: LLMCallStrategy,
  provider: LLMProvider,
  messages: Array<Message>,
  toolDefs: Array<ToolDef>,
  telemetryConfig: TelemetryConfig | undefined,
  emit: EmitFn,
  responseFormat: ResponseFormat | undefined,
  iteration: number
) {
  return Effect.gen(function* () {
    let response: LLMResponse;
    const turnId = randomUUID();
    yield* emit({
      phase: "executing",
      timestamp: Date.now(),
      turn: iteration,
      turnId,
      type: "turn.start",
    });
    yield* emit({ timestamp: Date.now(), turn: iteration, turnId, type: "stream.start" });
    try {
      const providerResponse = yield* strategy(
        provider,
        messages,
        toolDefs,
        telemetryConfig,
        emit,
        responseFormat
      );
      if (!isValidLLMResponse(providerResponse)) {
        throw new ProviderError(
          "unknown",
          `Invalid provider response shape: ${describeResponseShape(providerResponse)}`
        );
      }
      response = providerResponse;
      yield* emit({ timestamp: Date.now(), turn: iteration, turnId, type: "stream.end" });
      yield* emit({
        status: "completed",
        timestamp: Date.now(),
        turn: iteration,
        turnId,
        type: "turn.end",
      });
    } catch (error: unknown) {
      yield* emit({ timestamp: Date.now(), turn: iteration, turnId, type: "stream.end" });
      yield* emit({
        status: "error",
        timestamp: Date.now(),
        turn: iteration,
        turnId,
        type: "turn.end",
      });
      yield* emit({
        from: "Executing",
        timestamp: Date.now(),
        to: "Error",
        type: "agent.transition",
      });
      yield* emit({ message: getErrorMessage(error), timestamp: Date.now(), type: "agent.error" });
      throw error;
    }

    return response;
  });
}
