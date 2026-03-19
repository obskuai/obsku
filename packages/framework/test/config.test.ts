import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ConfigLive, ConfigService } from "../src/services/config";

describe("ConfigService", () => {
  test("should return default values when env vars are not set", async () => {
    const program = Effect.gen(function* () {
      const config = yield* ConfigService;
      return config;
    });

    const result = await Effect.runPromise(Effect.provide(program, ConfigLive));

    expect(result.toolConcurrency).toBe(3);
    expect(result.toolTimeout).toBe(30_000);
    expect(result.maxIterations).toBe(10);
  });

  test("should read OBSKU_TOOL_CONCURRENCY from env", async () => {
    const originalEnv = process.env.OBSKU_TOOL_CONCURRENCY;
    process.env.OBSKU_TOOL_CONCURRENCY = "5";

    try {
      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        return config.toolConcurrency;
      });

      const result = await Effect.runPromise(Effect.provide(program, ConfigLive));

      expect(result).toBe(5);
    } finally {
      if (originalEnv !== undefined) {
        process.env.OBSKU_TOOL_CONCURRENCY = originalEnv;
      } else {
        delete process.env.OBSKU_TOOL_CONCURRENCY;
      }
    }
  });

  test("should read OBSKU_TOOL_TIMEOUT from env", async () => {
    const originalEnv = process.env.OBSKU_TOOL_TIMEOUT;
    process.env.OBSKU_TOOL_TIMEOUT = "60000";

    try {
      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        return config.toolTimeout;
      });

      const result = await Effect.runPromise(Effect.provide(program, ConfigLive));

      expect(result).toBe(60_000);
    } finally {
      if (originalEnv !== undefined) {
        process.env.OBSKU_TOOL_TIMEOUT = originalEnv;
      } else {
        delete process.env.OBSKU_TOOL_TIMEOUT;
      }
    }
  });

  test("should read OBSKU_MAX_ITERATIONS from env", async () => {
    const originalEnv = process.env.OBSKU_MAX_ITERATIONS;
    process.env.OBSKU_MAX_ITERATIONS = "20";

    try {
      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        return config.maxIterations;
      });

      const result = await Effect.runPromise(Effect.provide(program, ConfigLive));

      expect(result).toBe(20);
    } finally {
      if (originalEnv !== undefined) {
        process.env.OBSKU_MAX_ITERATIONS = originalEnv;
      } else {
        delete process.env.OBSKU_MAX_ITERATIONS;
      }
    }
  });
});
