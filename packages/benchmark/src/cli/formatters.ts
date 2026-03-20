/**
 * @obsku/benchmark CLI output formatters
 */

export function fmtStatus(status: string): string {
  return `[${status.toUpperCase().padEnd(7)}]`;
}

export function fmtScore(compositeScore: number | undefined): string {
  return typeof compositeScore === "number" ? ` score=${compositeScore.toFixed(3)}` : "";
}

export function fmtCost(estimatedCostUsd: number | undefined): string {
  return typeof estimatedCostUsd === "number" ? ` cost=$${estimatedCostUsd.toFixed(8)}` : "";
}

export function fmtDelta(delta: number): string {
  return (delta >= 0 ? "+" : "") + delta.toFixed(3);
}

export function fmtTokens(
  usage: { inputTokens?: number; outputTokens?: number } | undefined
): string {
  if (!usage) return "";
  return ` tokens=${usage.inputTokens ?? 0}in/${usage.outputTokens ?? 0}out`;
}
