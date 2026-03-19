import { Effect } from "effect";
import { instrumentLLMCall } from "../telemetry/instrument";
import { addSpanAttributes } from "../telemetry/tracer";
import type { LLMCallStrategy } from "./agent-loop/index";

export type { OnEntityExtractFn } from "./agent-loop/index";

export const nonStreamingStrategy: LLMCallStrategy = (
  provider,
  messages,
  toolDefs,
  telemetryConfig,
  _emit,
  responseFormat
) =>
  Effect.promise(() =>
    instrumentLLMCall(telemetryConfig, "unknown", "unknown", async () => {
      const response = await provider.chat(
        messages,
        toolDefs.length > 0 ? toolDefs : undefined,
        responseFormat ? { responseFormat } : undefined
      );
      addSpanAttributes(telemetryConfig, {
        "gen_ai.usage.input_tokens": response.usage.inputTokens,
        "gen_ai.usage.output_tokens": response.usage.outputTokens,
      });
      return response;
    })
  );
