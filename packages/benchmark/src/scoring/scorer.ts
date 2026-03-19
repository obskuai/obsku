import type {
  AgentCompleteEvent,
  CanonicalAgentEvent,
  ToolCallEvent,
  ToolResultEvent,
} from "@obsku/framework";
import type { MetricResult as ScenarioMetricResult } from "../types/run";
import type { ScoringCriteria } from "../types/scenario";
import {
  buildMetricResult,
  evaluateTolerance,
  type Scorer,
  type MetricResult as ScorerMetricResult,
  type ToleranceBand,
} from "./types";

export type OutputPattern = RegExp | string;

const EXACT_PASS_TOLERANCE: ToleranceBand = { max: 1, min: 1 };

type CheckpointSavedEvent = Extract<CanonicalAgentEvent, { type: "checkpoint.saved" }>;
type CompactionEvent = Extract<CanonicalAgentEvent, { type: "context.compacted" }>;
type TurnStartEvent = Extract<CanonicalAgentEvent, { type: "turn.start" }>;

export function ratio(parts: readonly boolean[]): number {
  return parts.filter(Boolean).length / Math.max(parts.length, 1);
}

function resolveTolerance(tolerance?: ToleranceBand): ToleranceBand {
  return tolerance ?? EXACT_PASS_TOLERANCE;
}
function findUsage(
  events: readonly CanonicalAgentEvent[]
): AgentCompleteEvent["usage"] | undefined {
  return [...events]
    .reverse()
    .find((event): event is AgentCompleteEvent => event.type === "agent.complete")?.usage;
}

function patternToString(pattern: OutputPattern): string {
  return typeof pattern === "string" ? JSON.stringify(pattern) : pattern.toString();
}

function matchesPattern(output: string, pattern: OutputPattern): boolean {
  if (typeof pattern === "string") {
    return output.toLowerCase().includes(pattern.toLowerCase());
  }

  const flags = pattern.flags.replaceAll("g", "").replaceAll("y", "");
  return new RegExp(pattern.source, flags).test(output);
}

const TURN_LIFECYCLE_VERSION = "1.0.0";
const TOOL_PAIRING_VERSION = "1.0.0";
const USAGE_TRACKING_VERSION = "1.0.0";
const OUTPUT_CONTENT_VERSION = "1.0.0";
const CHECKPOINT_EVENTS_VERSION = "1.0.0";
const COMPACTION_EVENTS_VERSION = "1.0.0";

export function scoreTurnLifecycle(
  events: readonly CanonicalAgentEvent[],
  tolerance?: ToleranceBand
): ScorerMetricResult {
  // Single-pass event counting
  const counts = events.reduce(
    (acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Build index maps for O(1) turnId lookups
  const streamStartMap = new Map<string, number>();
  const streamEndMap = new Map<string, number>();
  const turnEndMap = new Map<string, number>();

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!;
    if (event.type === "stream.start" && event.turnId) {
      streamStartMap.set(event.turnId, i);
    } else if (event.type === "stream.end" && event.turnId) {
      streamEndMap.set(event.turnId, i);
    } else if (event.type === "turn.end" && event.turnId) {
      turnEndMap.set(event.turnId, i);
    }
  }

  const turnStarts = events.filter((event): event is TurnStartEvent => event.type === "turn.start");
  const completeTurnCount = turnStarts.filter((turnStart) => {
    const turnId = turnStart.turnId;
    const streamStartIndex = streamStartMap.get(turnId) ?? -1;
    const streamEndIndex = streamEndMap.get(turnId) ?? -1;
    const turnEndIndex = turnEndMap.get(turnId) ?? -1;

    return (
      streamStartIndex > -1 && streamEndIndex > streamStartIndex && turnEndIndex > streamEndIndex
    );
  }).length;
  const score = turnStarts.length > 0 ? completeTurnCount / turnStarts.length : 0;

  return buildMetricResult(
    score,
    resolveTolerance(tolerance),
    {
      completeTurnCount,
      streamEndCount: counts["stream.end"] ?? 0,
      streamStartCount: counts["stream.start"] ?? 0,
      turnCount: turnStarts.length,
      turnEndCount: counts["turn.end"] ?? 0,
    },
    turnStarts.length > 0
      ? `complete turn lifecycles=${completeTurnCount}/${turnStarts.length}`
      : "missing turn.start events",
    TURN_LIFECYCLE_VERSION
  );
}

export function scoreToolPairing(
  events: readonly CanonicalAgentEvent[],
  tolerance?: ToleranceBand
): ScorerMetricResult {
  const calls = events.filter((event): event is ToolCallEvent => event.type === "tool.call");
  const results = events.filter((event): event is ToolResultEvent => event.type === "tool.result");
  const resultCountByCallId = new Map<string, number>();

  for (const result of results) {
    resultCountByCallId.set(result.toolUseId, (resultCountByCallId.get(result.toolUseId) ?? 0) + 1);
  }

  const matchedCallCount = calls.filter(
    (call) => resultCountByCallId.get(call.toolUseId) === 1
  ).length;
  const callIds = new Set(calls.map((call) => call.toolUseId));
  const matchedResultCount = results.filter((result) => callIds.has(result.toolUseId)).length;
  const unmatchedCallCount = calls.length - matchedCallCount;
  const unmatchedResultCount = results.length - matchedResultCount;

  return buildMetricResult(
    ratio([
      calls.length > 0,
      results.length > 0,
      unmatchedCallCount === 0,
      unmatchedResultCount === 0,
    ]),
    resolveTolerance(tolerance),
    {
      matchedCallCount,
      matchedResultCount,
      toolCallCount: calls.length,
      toolResultCount: results.length,
      unmatchedCallCount,
      unmatchedResultCount,
    },
    `matchedCalls=${matchedCallCount}/${calls.length}, matchedResults=${matchedResultCount}/${results.length}`,
    TOOL_PAIRING_VERSION
  );
}

export function scoreUsageTracking(
  events: readonly CanonicalAgentEvent[],
  tolerance?: ToleranceBand
): ScorerMetricResult {
  const usage = findUsage(events);
  const llmCalls = usage?.llmCalls ?? 0;
  const inputTokens = usage?.totalInputTokens ?? 0;
  const outputTokens = usage?.totalOutputTokens ?? 0;

  return buildMetricResult(
    ratio([llmCalls > 0, inputTokens > 0, outputTokens > 0]),
    resolveTolerance(tolerance),
    {
      inputTokens,
      llmCalls,
      outputTokens,
    },
    `llmCalls=${llmCalls}, inputTokens=${inputTokens}, outputTokens=${outputTokens}`,
    USAGE_TRACKING_VERSION
  );
}

export function scoreOutputContent(
  output: string,
  expectedPatterns: readonly OutputPattern[],
  tolerance?: ToleranceBand
): ScorerMetricResult {
  const matches = expectedPatterns.map((pattern) => matchesPattern(output, pattern));
  const matchedPatternCount = matches.filter(Boolean).length;
  const missingPatterns = expectedPatterns
    .filter((_, index) => !matches[index])
    .map(patternToString);
  const score = expectedPatterns.length > 0 ? matchedPatternCount / expectedPatterns.length : 1;

  return buildMetricResult(
    score,
    resolveTolerance(tolerance),
    {
      expectedPatternCount: expectedPatterns.length,
      matchedPatternCount,
      outputLength: output.length,
    },
    missingPatterns.length > 0
      ? `matched=${matchedPatternCount}/${expectedPatterns.length}, missing=${missingPatterns.join(", ")}`
      : `matched=${matchedPatternCount}/${expectedPatterns.length}`,
    OUTPUT_CONTENT_VERSION
  );
}

export function scoreCheckpointEvents(
  events: readonly CanonicalAgentEvent[],
  tolerance?: ToleranceBand
): ScorerMetricResult {
  const checkpointEvents = events.filter(
    (event): event is CheckpointSavedEvent => event.type === "checkpoint.saved"
  );
  const identifiedCheckpointCount = checkpointEvents.filter(
    (event) => typeof event.checkpointId === "string" && event.checkpointId.length > 0
  ).length;

  return buildMetricResult(
    ratio([
      checkpointEvents.length > 0,
      checkpointEvents.length > 0 && identifiedCheckpointCount === checkpointEvents.length,
    ]),
    resolveTolerance(tolerance),
    {
      checkpointEventCount: checkpointEvents.length,
      identifiedCheckpointCount,
    },
    `checkpointEvents=${checkpointEvents.length}, identified=${identifiedCheckpointCount}/${checkpointEvents.length}`,
    CHECKPOINT_EVENTS_VERSION
  );
}

export function scoreCompactionEvents(
  events: readonly CanonicalAgentEvent[],
  tolerance?: ToleranceBand
): ScorerMetricResult {
  const compactionEvents = events.filter(
    (event): event is CompactionEvent => event.type === "context.compacted"
  );
  const savedTokensCount = compactionEvents.filter(
    (event) => (event.estimatedTokensSaved ?? 0) > 0
  ).length;
  const shrunkMessageCount = compactionEvents.filter(
    (event) => event.originalMessages > event.compactedMessages
  ).length;

  return buildMetricResult(
    ratio([
      compactionEvents.length > 0,
      compactionEvents.length > 0 && shrunkMessageCount === compactionEvents.length,
      compactionEvents.length > 0 && savedTokensCount === compactionEvents.length,
    ]),
    resolveTolerance(tolerance),
    {
      compactionEventCount: compactionEvents.length,
      savedTokensCount,
      shrunkMessageCount,
    },
    `compactionEvents=${compactionEvents.length}, shrunk=${shrunkMessageCount}/${compactionEvents.length}, savedTokens=${savedTokensCount}/${compactionEvents.length}`,
    COMPACTION_EVENTS_VERSION
  );
}

export function createTurnLifecycleScorer(
  tolerance?: ToleranceBand
): Scorer<void, readonly CanonicalAgentEvent[]> {
  return {
    name: "turn_lifecycle",
    version: TURN_LIFECYCLE_VERSION,
    score: (_input, output) => scoreTurnLifecycle(output, tolerance),
  };
}

export function createToolPairingScorer(
  tolerance?: ToleranceBand
): Scorer<void, readonly CanonicalAgentEvent[]> {
  return {
    name: "tool_pairing",
    version: TOOL_PAIRING_VERSION,
    score: (_input, output) => scoreToolPairing(output, tolerance),
  };
}

export function createUsageTrackingScorer(
  tolerance?: ToleranceBand
): Scorer<void, readonly CanonicalAgentEvent[]> {
  return {
    name: "usage_tracking",
    version: USAGE_TRACKING_VERSION,
    score: (_input, output) => scoreUsageTracking(output, tolerance),
  };
}

export function createOutputContentScorer(
  tolerance?: ToleranceBand
): Scorer<readonly OutputPattern[], string> {
  return {
    name: "output_content",
    version: OUTPUT_CONTENT_VERSION,
    score: (input, output) => scoreOutputContent(output, input, tolerance),
  };
}

export function createCheckpointEventsScorer(
  tolerance?: ToleranceBand
): Scorer<void, readonly CanonicalAgentEvent[]> {
  return {
    name: "checkpoint_events",
    version: CHECKPOINT_EVENTS_VERSION,
    score: (_input, output) => scoreCheckpointEvents(output, tolerance),
  };
}

export function createCompactionEventsScorer(
  tolerance?: ToleranceBand
): Scorer<void, readonly CanonicalAgentEvent[]> {
  return {
    name: "compaction_event_presence",
    version: COMPACTION_EVENTS_VERSION,
    score: (_input, output) => scoreCompactionEvents(output, tolerance),
  };
}

export const turnLifecycleScorer = createTurnLifecycleScorer();
export const toolPairingScorer = createToolPairingScorer();
export const usageTrackingScorer = createUsageTrackingScorer();
export const outputContentScorer = createOutputContentScorer();
export const checkpointEventsScorer = createCheckpointEventsScorer();
export const compactionEventsScorer = createCompactionEventsScorer();

export function toScenarioMetricResult(
  criterion: ScoringCriteria,
  result: ScorerMetricResult
): ScenarioMetricResult {
  return {
    name: criterion.name,
    ...(result.reason ? { note: result.reason } : {}),
    passed: evaluateTolerance(result.score, criterion.tolerance),
    score: result.score,
    toleranceBand: criterion.tolerance,
    weight: criterion.weight,
    ...(result.scorerVersion ? { scorerVersion: result.scorerVersion } : {}),
  };
}

export function buildScenarioMetricResults(
  criteria: readonly ScoringCriteria[],
  resultsByName: Readonly<Record<string, ScorerMetricResult | undefined>>
): ScenarioMetricResult[] {
  return criteria.map((criterion) => {
    const result = resultsByName[criterion.name];

    if (result) {
      return toScenarioMetricResult(criterion, result);
    }

    const score = 0;
    return {
      name: criterion.name,
      note: `missing scorer result for ${criterion.name}`,
      passed: evaluateTolerance(score, criterion.tolerance),
      score,
      toleranceBand: criterion.tolerance,
      weight: criterion.weight,
    };
  });
}
