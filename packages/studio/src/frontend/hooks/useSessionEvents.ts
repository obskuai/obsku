import type { EventDisplayInfo } from "../../shared/types";
import { type UseEventStreamResult, useEventStream } from "./useEventStream";

export function useSessionEvents<TEvent extends EventDisplayInfo = EventDisplayInfo>(
  sessionId?: string
): UseEventStreamResult<TEvent> {
  return useEventStream<TEvent>({ sessionId });
}
