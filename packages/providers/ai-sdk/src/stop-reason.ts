import type { LLMResponse } from "@obsku/framework";
import type { FinishReason } from "ai";

const STOP_REASON_MAP: Record<string, LLMResponse["stopReason"]> = {
  stop: "end_turn",
  "tool-calls": "tool_use",
  tool_calls: "tool_use",
  length: "max_tokens",
};

export function mapAiSdkStopReason(
  reason: string | FinishReason | undefined
): LLMResponse["stopReason"] {
  return (
    STOP_REASON_MAP[reason ?? "stop"] ??
    (reason as LLMResponse["stopReason"] | undefined) ??
    "end_turn"
  );
}
