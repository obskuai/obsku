import type { MemoryProvider } from "../memory/types";
import type { MemoryConfig } from "../types/index";

export function isMemoryProvider(memory: unknown): memory is MemoryProvider {
  return (
    memory !== null &&
    typeof memory === "object" &&
    "load" in memory &&
    "save" in memory &&
    typeof (memory as MemoryProvider).load === "function" &&
    typeof (memory as MemoryProvider).save === "function"
  );
}

export function isMemoryConfig(memory: unknown): memory is MemoryConfig {
  return (
    memory !== null &&
    typeof memory === "object" &&
    ("enabled" in memory || "store" in memory || "hooks" in memory)
  );
}
