import { randomUUID } from "node:crypto";
import type { RunSpec } from "../types";
import type { SuiteState } from "./types";

function formatDateStamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function defaultSessionPrefix(now: Date = new Date()): string {
  return `bench-${formatDateStamp(now)}`;
}

export function createSuiteState(spec: RunSpec): SuiteState {
  const startedAt = new Date();
  const sessionPrefix = spec.sessionPrefix ?? defaultSessionPrefix(startedAt);
  return {
    results: [],
    runId: `${sessionPrefix}-suite-${startedAt.getTime()}-${randomUUID().slice(0, 8)}`,
    startedAt,
    totalCostUsd: 0,
  };
}
