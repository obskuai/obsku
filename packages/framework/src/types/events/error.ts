/**
 * Error events
 */

import type { TimestampedEvent } from "./base.ts";

export interface HookErrorEvent extends TimestampedEvent<"hook.error"> {
  readonly error: string;
  readonly hookName: string;
}

export interface ParseErrorEvent extends TimestampedEvent<"parse.error"> {
  readonly error: string;
  readonly rawInput?: string;
  readonly toolName?: string;
  readonly toolUseId?: string;
}
