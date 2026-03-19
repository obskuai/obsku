import { Effect } from "effect";
import type { MemoryConfig } from "../types/index";
import { buildMemoryHookContext, executeMemorySave } from "./memory-integration";
import { emitMemorySaveAfter, type MemoryHookPersistenceArgs } from "./persistence-shared";

export function selectMemoryHookPersistence(
  sessionId: string | undefined,
  args: Omit<MemoryHookPersistenceArgs, "memoryConfig" | "sessionId">,
  memoryConfig: MemoryConfig | undefined
): MemoryHookPersistenceArgs | undefined {
  if (!memoryConfig?.enabled || !memoryConfig.store || !sessionId) {
    return undefined;
  }

  return {
    ...args,
    memoryConfig,
    sessionId,
  };
}

export function persistMemoryHookResults(args: MemoryHookPersistenceArgs) {
  return emitMemorySaveAfter(
    Effect.gen(function* () {
      const memCtx = buildMemoryHookContext(
        args.sessionId,
        args.def.name,
        args.messages,
        args.memoryConfig,
        args.input
      );
      yield* Effect.promise(() => executeMemorySave(args.memoryConfig, memCtx, args.provider));
    }),
    args.emit,
    () => ({
      messageCount: args.messages.length,
      sessionId: args.sessionId,
    })
  );
}
