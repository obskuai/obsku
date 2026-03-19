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
  return typeof estimatedCostUsd === "number" ? ` cost=$${estimatedCostUsd.toFixed(4)}` : "";
}

export function fmtDelta(delta: number): string {
  return (delta >= 0 ? "+" : "") + delta.toFixed(3);
}
