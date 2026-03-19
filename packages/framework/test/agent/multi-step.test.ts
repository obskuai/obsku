import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { ObskuConfig } from "../../src/services/config";
import type { StepContext, ToolDef } from "../../src/types";
import { defaultConfig, makeEmit, makePlugin, makeProvider } from "../utils/helpers";
import { runReactLoop } from "../utils/loop-helpers";
import { mixedResponse, textResponse, toolResponse } from "../utils/responses";

const echoPlugin = makePlugin("echo", { echoed: true });
const echoToolDef: ToolDef = {
  description: "echo",
  inputSchema: { properties: {}, required: [], type: "object" },
  name: "echo",
};

describe("multi-step control: stopWhen", () => {
  test("stopWhen returning true at iteration 2 stops agent early", async () => {
    let callCount = 0;
    const provider = makeProvider(async () => {
      callCount++;
      return mixedResponse(`iter ${callCount}`, [{ id: `t${callCount}`, name: "echo" }]);
    });

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "go", type: "text" }], role: "user" }],
        [echoToolDef],
        new Map([["echo", echoPlugin]]),
        provider,
        { ...defaultConfig, maxIterations: 10 },
        new Set(),
        undefined,
        makeEmit([]),
        (ctx) => ctx.iteration >= 1,
        undefined
      )
    );

    expect(callCount).toBe(2);
    expect(result).toBe("iter 2");
  });

  test("stopWhen returning false allows agent to continue to natural end", async () => {
    let callCount = 0;
    const provider = makeProvider(async () => {
      callCount++;
      if (callCount <= 2) {
        return toolResponse([{ id: `t${callCount}`, name: "echo" }]);
      }
      return textResponse("done");
    });

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "go", type: "text" }], role: "user" }],
        [echoToolDef],
        new Map([["echo", echoPlugin]]),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit([]),
        () => false,
        undefined
      )
    );

    expect(callCount).toBe(3);
    expect(result).toBe("done");
  });

  test("maxIterations still enforced even with stopWhen that never triggers", async () => {
    let callCount = 0;
    const provider = makeProvider(async () => {
      callCount++;
      return mixedResponse(`iter ${callCount}`, [{ id: `t${callCount}`, name: "echo" }]);
    });

    const config: ObskuConfig = { ...defaultConfig, maxIterations: 3 };

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "go", type: "text" }], role: "user" }],
        [echoToolDef],
        new Map([["echo", echoPlugin]]),
        provider,
        config,
        new Set(),
        undefined,
        makeEmit([]),
        () => false,
        undefined
      )
    );

    expect(callCount).toBe(3);
  });
});

describe("multi-step control: onStepFinish", () => {
  test("onStepFinish called after each iteration with correct StepContext", async () => {
    const contexts: Array<StepContext> = [];
    let callCount = 0;
    const provider = makeProvider(async () => {
      callCount++;
      if (callCount <= 2) {
        return mixedResponse(`iter ${callCount}`, [{ id: `t${callCount}`, name: "echo" }]);
      }
      return textResponse("done");
    });

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "go", type: "text" }], role: "user" }],
        [echoToolDef],
        new Map([["echo", echoPlugin]]),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit([]),
        undefined,
        (ctx) => {
          contexts.push({ ...ctx });
        }
      )
    );

    expect(contexts).toHaveLength(2);
    expect(contexts[0].iteration).toBe(0);
    expect(contexts[1].iteration).toBe(1);
    expect(contexts[0].toolResults.length).toBeGreaterThan(0);
    expect(contexts[0].toolResults[0].toolName).toBe("echo");
    expect(contexts[0].lastResponse.stopReason).toBe("tool_use");
  });

  test("onStepFinish throwing error does not crash agent", async () => {
    let callCount = 0;
    const provider = makeProvider(async () => {
      callCount++;
      if (callCount === 1) {
        return toolResponse([{ id: "t1", name: "echo" }]);
      }
      return textResponse("survived");
    });

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "go", type: "text" }], role: "user" }],
        [echoToolDef],
        new Map([["echo", echoPlugin]]),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit([]),
        undefined,
        () => {
          throw new Error("callback boom");
        }
      )
    );

    expect(result).toBe("survived");
    expect(callCount).toBe(2);
  });

  test("async onStepFinish is awaited", async () => {
    const order: Array<string> = [];
    let callCount = 0;
    const provider = makeProvider(async () => {
      callCount++;
      if (callCount === 1) {
        return toolResponse([{ id: "t1", name: "echo" }]);
      }
      order.push("llm-call-2");
      return textResponse("done");
    });

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "go", type: "text" }], role: "user" }],
        [echoToolDef],
        new Map([["echo", echoPlugin]]),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit([]),
        undefined,
        async (_ctx) => {
          await new Promise((r) => setTimeout(r, 10));
          order.push("onStepFinish");
        }
      )
    );

    expect(order).toEqual(["onStepFinish", "llm-call-2"]);
  });
});

describe("multi-step control: no callbacks", () => {
  test("no stopWhen/onStepFinish preserves existing behavior", async () => {
    let callCount = 0;
    const provider = makeProvider(async () => {
      callCount++;
      if (callCount === 1) {
        return toolResponse([{ id: "t1", name: "echo" }]);
      }
      return textResponse("normal end");
    });

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "go", type: "text" }], role: "user" }],
        [echoToolDef],
        new Map([["echo", echoPlugin]]),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit([])
      )
    );

    expect(result).toBe("normal end");
    expect(callCount).toBe(2);
  });
});
