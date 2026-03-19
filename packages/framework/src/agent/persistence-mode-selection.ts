import { Effect } from "effect";
import { assertNever } from "../utils";
import type { CheckpointStore } from "../checkpoint/index";
import type { AgentDef, Message } from "../types/index";
import { persistCheckpointMessages, selectCheckpointPersistence } from "./persistence-checkpoint";
import { persistLegacyMessages, selectLegacyPersistence } from "./persistence-legacy";
import type {
  CheckpointPersistenceArgs,
  LegacyPersistenceArgs,
  PersistenceEmitter,
} from "./persistence-shared";

export type StoragePersistenceSelection =
  | { args: CheckpointPersistenceArgs; kind: "checkpoint" }
  | { args: LegacyPersistenceArgs; kind: "legacy" }
  | { kind: "none" };

export function selectStoragePersistence(ctx: {
  checkpointStore: CheckpointStore | undefined;
  def: AgentDef;
  effectivePrompt: string;
  emit: PersistenceEmitter;
  history: Array<Message>;
  input: string;
  messages: Array<Message>;
  sessionId: string | undefined;
}): StoragePersistenceSelection {
  const checkpointPersistence = selectCheckpointPersistence(ctx.checkpointStore, ctx.sessionId, {
    def: ctx.def,
    emit: ctx.emit,
    history: ctx.history,
    input: ctx.input,
    messages: ctx.messages,
    resolvedPrompt: ctx.effectivePrompt,
  });

  if (checkpointPersistence) {
    return { args: checkpointPersistence, kind: "checkpoint" };
  }

  const legacyPersistence = selectLegacyPersistence(ctx.checkpointStore, ctx.sessionId, {
    def: ctx.def,
    emit: ctx.emit,
    messages: ctx.messages,
  });

  if (legacyPersistence) {
    return { args: legacyPersistence, kind: "legacy" };
  }

  return { kind: "none" };
}

export function persistSelectedStorage(selection: StoragePersistenceSelection) {
  switch (selection.kind) {
    case "checkpoint":
      return persistCheckpointMessages(selection.args);
    case "legacy":
      return persistLegacyMessages(selection.args);
    case "none":
      return Effect.void;
    default:
      return assertNever(selection);
  }
}
