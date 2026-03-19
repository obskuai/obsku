import crypto from "node:crypto";
import type { Fact, ListFactsOptions } from "../../memory/index";
import type { InMemoryState } from "./types";

/** Create a defensive shallow copy of a fact with nested embedding cloned */
function copyFact(fact: Fact): Fact {
  return {
    ...fact,
    ...(fact.embedding && { embedding: [...fact.embedding] }),
  };
}

export function saveFact(state: InMemoryState, fact: Omit<Fact, "id" | "createdAt">): Fact {
  const fullFact: Fact = {
    ...fact,
    createdAt: Date.now(),
    id: crypto.randomUUID(),
  };

  state.facts.set(fullFact.id, fullFact);
  return copyFact(fullFact);
}

export function getFact(state: InMemoryState, id: string): Fact | null {
  const fact = state.facts.get(id);
  return fact ? copyFact(fact) : null;
}

export function listFacts(state: InMemoryState, options: ListFactsOptions): Array<Fact> {
  let results = Array.from(state.facts.values());

  if (options.workspaceId) {
    results = results.filter((f) => f.workspaceId === options.workspaceId);
  }
  if (options.minConfidence !== undefined) {
    const minConfidence = options.minConfidence;
    results = results.filter((f) => f.confidence >= minConfidence);
  }
  if (options.limit && options.limit > 0) {
    results = results.slice(0, options.limit);
  }

  return results.map(copyFact);
}

export function deleteFact(state: InMemoryState, id: string): void {
  state.facts.delete(id);
}
