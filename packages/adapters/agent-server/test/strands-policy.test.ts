import { describe, expect, it } from "bun:test";
import { createStrandsPolicy } from "../src/strands-policy";

describe("createStrandsPolicy", () => {
  it("separate instances do not share state across sessions", () => {
    const policy1 = createStrandsPolicy();
    const policy2 = createStrandsPolicy();

    const timestamp = Date.now();
    const context = { surface: "transport" as const };

    policy1.emit({
      event: { type: "turn.start", turn: 1, turnId: "turn-1", timestamp },
      context,
    });
    policy1.emit({
      event: { type: "stream.start", turn: 1, turnId: "turn-1", timestamp },
      context,
    });
    policy1.emit({
      event: {
        type: "stream.chunk",
        content: "Hello world",
        phase: "executing",
        timestamp,
      },
      context,
    });

    const result1 = policy1.emit({
      event: { type: "stream.end", turn: 1, turnId: "turn-1", timestamp },
      context,
    });
    expect(result1).toContain('"contentBlockStop"');
    expect(result1).toContain('"contentBlockIndex":0');

    const result2 = policy2.emit({
      event: { type: "turn.start", turn: 1, turnId: "turn-2", timestamp },
      context,
    });
    expect(result2).toContain('"messageStart"');

    const result3 = policy2.emit({
      event: { type: "stream.start", turn: 1, turnId: "turn-2", timestamp },
      context,
    });
    expect(result3).toContain('"contentBlockStart"');
    expect(result3).toContain('"contentBlockIndex":0');
  });
});
