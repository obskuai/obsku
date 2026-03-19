import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Effect } from "effect";
import { isAsyncIterable, PluginExecError, plugin } from "../src/index";

async function* asyncGen() {
  yield 1;
}

function* syncGen() {
  yield 1;
}

describe("isAsyncIterable utility", () => {
  test("returns true for async generator", () => {
    expect(isAsyncIterable(asyncGen())).toBe(true);
  });

  test("returns true for AsyncIterable object", () => {
    const obj = {
      async *[Symbol.asyncIterator]() {
        yield 1;
      },
    };
    expect(isAsyncIterable(obj)).toBe(true);
  });

  test("returns false for Promise", () => {
    expect(isAsyncIterable(Promise.resolve(1))).toBe(false);
  });

  test("returns false for regular iterable", () => {
    expect(isAsyncIterable(syncGen())).toBe(false);
  });

  test("returns false for null/undefined", () => {
    expect(isAsyncIterable(null)).toBe(false);
    expect(isAsyncIterable(undefined)).toBe(false);
  });

  test("returns false for primitive values", () => {
    expect(isAsyncIterable(42)).toBe(false);
    expect(isAsyncIterable("string")).toBe(false);
    expect(isAsyncIterable(true)).toBe(false);
  });

  test("returns false for plain objects", () => {
    expect(isAsyncIterable({})).toBe(false);
    // eslint-disable-next-line unicorn/no-thenable -- Intentionally testing thenable detection
    expect(isAsyncIterable({ then: () => {} })).toBe(false);
  });
});
describe("plugin() streaming support", () => {
  test("async generator returns last yielded value as result", async () => {
    const p = plugin({
      description: "Yields multiple values",
      name: "streaming-plugin",
      params: z.object({}),
      run: async function* (_input, _ctx) {
        yield "chunk-1";
        yield "chunk-2";
        yield "final-result";
      },
    });

    const result = await Effect.runPromise(p.execute({}));
    expect(result).toEqual({ result: "final-result" });
  });

  test("single-yield async generator works", async () => {
    const p = plugin({
      description: "Yields once",
      name: "single-yield",
      params: z.object({}),
      run: async function* () {
        yield "only-value";
      },
    });

    const result = await Effect.runPromise(p.execute({}));
    expect(result).toEqual({ result: "only-value" });
  });

  test("empty async generator returns undefined", async () => {
    const p = plugin({
      description: "Yields nothing",
      name: "empty-generator",
      params: z.object({}),
      run: async function* () {},
    });

    const result = await Effect.runPromise(p.execute({}));
    expect(result).toEqual({ result: undefined });
  });

  test("async generator with params works", async () => {
    const p = plugin({
      description: "Streams with params",
      name: "streaming-with-params",
      params: z.object({
        count: z.number(),
      }),
      run: async function* (input) {
        const count = input.count as number;
        for (let i = 0; i < count; i++) {
          yield `step-${i}`;
        }
        yield `completed-${count}`;
      },
    });

    const result = await Effect.runPromise(p.execute({ count: 3 }));
    expect(result).toEqual({ result: "completed-3" });
  });

  test("async generator with ctx works", async () => {
    const p = plugin({
      description: "Streams with context",
      name: "streaming-with-ctx",
      params: z.object({}),
      run: async function* (_input, ctx) {
        ctx.logger.info("Starting stream");
        yield "step-1";
        ctx.logger.info("Step 1 done");
        yield "done";
      },
    });

    const result = await Effect.runPromise(p.execute({}));
    expect(result).toEqual({ result: "done" });
  });

  test("async generator error mid-stream wraps in PluginExecError", async () => {
    const p = plugin({
      description: "Fails mid-stream",
      name: "failing-stream",
      params: z.object({}),
      run: async function* () {
        yield "chunk-1";
        throw new Error("Stream error");
      },
    });

    const result = await Effect.runPromise(p.execute({}).pipe(Effect.either));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(PluginExecError);
      expect(result.left.pluginName).toBe("failing-stream");
      expect(result.left.cause).toBeInstanceOf(Error);
      expect((result.left.cause as Error).message).toBe("Stream error");
    }
  });

  test("async generator error on first yield wraps in PluginExecError", async () => {
    const p = plugin({
      description: "Fails immediately",
      name: "immediate-fail",
      params: z.object({}),
      run: async function* () {
        yield undefined as never;
        throw new Error("Immediate error");
      },
    });

    const result = await Effect.runPromise(p.execute({}).pipe(Effect.either));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(PluginExecError);
      expect(result.left.pluginName).toBe("immediate-fail");
    }
  });
});
describe("plugin() backward compatibility", () => {
  test("Promise-based plugin still works", async () => {
    const p = plugin({
      description: "Returns a promise",
      name: "promise-plugin",
      params: z.object({}),
      run: async () => "promise-result",
    });

    const result = await Effect.runPromise(p.execute({}));
    expect(result).toEqual({ isError: false, result: "promise-result" });
  });

  test("Promise-based with params still works", async () => {
    const p = plugin({
      description: "Promise with params",
      name: "promise-with-params",
      params: z.object({
        value: z.string(),
      }),
      run: async (input) => {
        return `got-${input.value}`;
      },
    });

    const result = await Effect.runPromise(p.execute({ value: "test" }));
    expect(result).toEqual({ isError: false, result: "got-test" });
  });

  test("Promise-based with ctx still works", async () => {
    const p = plugin({
      description: "Promise with context",
      name: "promise-with-ctx",
      params: z.object({}),
      run: async (_input, ctx) => {
        const result = await ctx.exec("echo", ["hello"]);
        return result.stdout.trim();
      },
    });

    const result = await Effect.runPromise(p.execute({}));
    expect(result).toEqual({ isError: false, result: "hello" });
  });

  test("Promise rejection still wraps in PluginExecError", async () => {
    const p = plugin({
      description: "Rejects with error",
      name: "failing-promise",
      params: z.object({}),
      run: async () => {
        throw new Error("Promise error");
      },
    });

    const result = await Effect.runPromise(p.execute({}).pipe(Effect.either));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(PluginExecError);
      expect(result.left.pluginName).toBe("failing-promise");
      expect(result.left.cause).toBeInstanceOf(Error);
      expect((result.left.cause as Error).message).toBe("Promise error");
    }
  });
});
describe("plugin() mixed scenarios", () => {
  test("complex async generator with multiple yields", async () => {
    const yielded: Array<string> = [];

    const p = plugin({
      description: "Complex streaming",
      name: "complex-stream",
      params: z.object({
        prefix: z.string().default("item"),
      }),
      run: async function* (input) {
        const prefix = input.prefix as string;
        for (let i = 1; i <= 5; i++) {
          const value = `${prefix}-${i}`;
          yielded.push(value);
          yield value;
        }
        yield `${prefix}-complete`;
      },
    });

    const result = await Effect.runPromise(p.execute({}));

    expect(result).toEqual({ result: "item-complete" });
    expect(yielded).toEqual(["item-1", "item-2", "item-3", "item-4", "item-5"]);
  });

  test("async generator yielding objects", async () => {
    const p = plugin({
      description: "Yields objects",
      name: "object-stream",
      params: z.object({}),
      run: async function* () {
        yield { status: "started" };
        yield { percent: 50, status: "progress" };
        yield { percent: 100, status: "progress" };
        yield { data: "final", status: "complete" };
      },
    });

    const result = await Effect.runPromise(p.execute({}));
    expect(result).toEqual({ result: JSON.stringify({ data: "final", status: "complete" }) });
  });

  test("async generator yielding numbers", async () => {
    const p = plugin({
      description: "Yields numbers",
      name: "number-stream",
      params: z.object({}),
      run: async function* () {
        yield 1;
        yield 2;
        yield 3;
        yield 42;
      },
    });

    const result = await Effect.runPromise(p.execute({}));
    expect(result).toEqual({ result: "42" });
  });
});
