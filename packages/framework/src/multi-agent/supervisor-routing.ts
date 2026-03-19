import { z } from "zod";
import { DEFAULTS } from "../defaults";
import type { AgentDef } from "../types";
import { extractJsonFromText } from "../utils";

const SupervisorRoutingSchema = z.object({ next: z.string() });

const FINISH_ROUTE = { next: "FINISH" } as const;

type SupervisorRoutingParseResult =
  | { output: { next: string }; status: "parsed" }
  | {
      output: typeof FINISH_ROUTE;
      reason: "invalid-structure" | "parse-failed";
      status: "fallback-finish";
    };

export type RoutingFallbackReason = "invalid-structure" | "parse-failed";

export function buildRoutingFallbackError(reason: RoutingFallbackReason): string {
  return `Supervisor routing ${reason}; defaulting to FINISH`;
}

export function parseSupervisorOutputResult(output: unknown): SupervisorRoutingParseResult {
  if (output && typeof output === "object") {
    const parsed = SupervisorRoutingSchema.safeParse(output);
    if (parsed.success) {
      return { output: parsed.data, status: "parsed" };
    }

    return {
      output: FINISH_ROUTE,
      reason: "invalid-structure",
      status: "fallback-finish",
    };
  }

  if (typeof output === "string") {
    const extracted = extractJsonFromText(output);
    if (extracted != null) {
      const parsed = SupervisorRoutingSchema.safeParse(extracted);
      if (parsed.success) {
        return { output: parsed.data, status: "parsed" };
      }

      return {
        output: FINISH_ROUTE,
        reason: "invalid-structure",
        status: "fallback-finish",
      };
    }
  }

  return {
    output: FINISH_ROUTE,
    reason: "parse-failed",
    status: "fallback-finish",
  };
}

export function parseSupervisorOutput(output: unknown): { next: string } {
  return parseSupervisorOutputResult(output).output;
}

export function buildSupervisorPrompt(workers: Array<AgentDef>): string {
  const workerList = workers
    .map((worker) => {
      const promptStr = typeof worker.prompt === "string" ? worker.prompt : "[dynamic]";
      const truncated =
        promptStr.length > DEFAULTS.supervisor.promptPreviewLength
          ? promptStr.slice(0, DEFAULTS.supervisor.promptPreviewLength) + "..."
          : promptStr;
      return `- ${worker.name}: ${truncated}`;
    })
    .join("\n");

  return `You are a supervisor coordinating a team of workers.

Available workers:
${workerList}

Based on the task, decide which worker should handle it next.
Respond with JSON: { "next": "<worker_name>" } or { "next": "FINISH" } when done.`;
}
