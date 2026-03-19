function formatStrandsEvent(payload: object): string {
  return `data: ${JSON.stringify({ event: payload })}\n\n`;
}

export function messageStart(): string {
  return formatStrandsEvent({ messageStart: { role: "assistant" } });
}

export function contentBlockStart(index: number): string {
  return formatStrandsEvent({
    contentBlockStart: { contentBlockIndex: index, start: { text: "" } },
  });
}

export function contentBlockDelta(index: number, text: string): string {
  return formatStrandsEvent({
    contentBlockDelta: { contentBlockIndex: index, delta: { text } },
  });
}

export function contentBlockStop(index: number): string {
  return formatStrandsEvent({
    contentBlockStop: { contentBlockIndex: index },
  });
}

export function toolUseContentBlockStart(index: number, toolUseId: string, name: string): string {
  return formatStrandsEvent({
    contentBlockStart: {
      contentBlockIndex: index,
      start: { toolUse: { name, toolUseId } },
    },
  });
}

export function toolUseContentBlockDelta(index: number, input: string): string {
  return formatStrandsEvent({
    contentBlockDelta: { contentBlockIndex: index, delta: { toolUse: { input } } },
  });
}

export function messageStop(reason: string): string {
  return formatStrandsEvent({
    messageStop: { stopReason: reason },
  });
}

export function metadata(usage: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}): string {
  return formatStrandsEvent({
    metadata: { usage },
  });
}
