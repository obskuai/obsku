import { Effect } from "effect";
import type { CheckpointStore } from "../checkpoint/index";
import type { MemoryProvider } from "../memory/types";
import { isMemoryProvider } from "./guards";
import { emitMemorySaveAfter, type LegacyPersistenceArgs } from "./persistence-shared";

export function selectLegacyPersistence(
  checkpointStore: CheckpointStore | undefined,
  sessionId: string | undefined,
  args: Omit<LegacyPersistenceArgs, "sessionId">
): LegacyPersistenceArgs | undefined {
  if (checkpointStore || !sessionId || !args.def.memory || !isMemoryProvider(args.def.memory)) {
    return undefined;
  }

  return {
    ...args,
    sessionId,
  };
}

export function persistLegacyMessages(args: LegacyPersistenceArgs) {
  return emitMemorySaveAfter(
    Effect.promise(() => (args.def.memory as MemoryProvider).save(args.sessionId, args.messages)),
    args.emit,
    () => ({
      messageCount: args.messages.length,
      sessionId: args.sessionId,
    })
  );
}
