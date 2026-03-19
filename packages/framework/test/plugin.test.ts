// =============================================================================
// Tests for plugin() factory, PluginCtx, and PluginRegistry
// IMPORTANT: No `import { Effect }` — consumer code stays Effect-free
// =============================================================================

import { describe, expect, test } from "bun:test";
import { z } from "zod";
// We need Effect only for *running* internal plugin effects in tests
// This is framework-internal test code, not consumer code
import { Effect, Fiber } from "effect";
import type { PluginDef } from "../src/index";
import { ExecTimeoutError, PluginExecError, plugin } from "../src/index";

// ---------------------------------------------------------------------------
// plugin() factory
// ---------------------------------------------------------------------------

describe("plugin() factory", () => {
  test("creates InternalPlugin with correct metadata", () => {
    const p = plugin({
      description: "A test plugin",
      name: "test-plugin",
      params: z.object({
        target: z.string(),
      }),
      run: async () => "ok",
    });

    expect(p.name).toBe("test-plugin");
    expect(p.description).toBe("A test plugin");
    expect(p.params).toHaveProperty("target");
  });

  test("passes directives to InternalPlugin", () => {
    const directives = [
      {
        inject: "injected content",
        match: (result: string, _input: Record<string, unknown>) => result.includes("test"),
        name: "test-directive",
      },
    ];

    const p = plugin({
      description: "Tests directives",
      directives,
      name: "directive-test",
      params: z.object({}),
      run: async () => "ok",
    });

    expect(p.directives).toBeDefined();
    expect(p.directives).toHaveLength(1);
    expect(p.directives?.[0].name).toBe("test-directive");
    expect(typeof p.directives?.[0].match).toBe("function");
    expect(p.directives?.[0].inject).toBe("injected content");
  });

  test("directives are optional", () => {
    const p = plugin({
      description: "No directives",
      name: "no-directives",
      params: z.object({}),
      run: async () => "ok",
    });

    expect(p.directives).toBeUndefined();
  });

  test("validates required params", async () => {
    const p = plugin({
      description: "Tests validation",
      name: "validator",
      params: z.object({
        host: z.string(),
        port: z.number(),
      }),
      run: async () => "should not reach",
    });

    // Missing both required params
    const result = await Effect.runPromise(p.execute({}).pipe(Effect.either));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(PluginExecError);
      expect(result.left.cause).toBeDefined();
    }
  });

  test("validates param types", async () => {
    const p = plugin({
      description: "Tests type validation",
      name: "type-checker",
      params: z.object({
        count: z.number(),
      }),
      run: async () => "ok",
    });

    const result = await Effect.runPromise(
      p.execute({ count: "not-a-number" }).pipe(Effect.either)
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.cause).toBeDefined();
    }
  });

  test("applies default values", async () => {
    let receivedInput: Record<string, unknown> = {};

    const p = plugin({
      description: "Tests defaults",
      name: "defaults",
      params: z.object({
        timeout: z.number().default(5000),
        verbose: z.boolean().default(false),
      }),
      run: async (input) => {
        receivedInput = input;
        return "ok";
      },
    });

    await Effect.runPromise(p.execute({}));
    expect(receivedInput.timeout).toBe(5000);
    expect(receivedInput.verbose).toBe(false);
  });

  test("passes through valid params", async () => {
    let receivedInput: Record<string, unknown> = {};

    const p = plugin({
      description: "Tests passthrough",
      name: "passthrough",
      params: z.object({
        target: z.string(),
      }),
      run: async (input) => {
        receivedInput = input;
        return input.target;
      },
    });

    const result = await Effect.runPromise(p.execute({ target: "example.com" }));
    expect(result).toEqual({ isError: false, result: "example.com" });
    expect(receivedInput.target).toBe("example.com");
  });
});

// ---------------------------------------------------------------------------
// PluginCtx.exec — subprocess execution
// ---------------------------------------------------------------------------

describe("PluginCtx.exec", () => {
  test("runs subprocess and captures stdout", async () => {
    const p = plugin({
      description: "Runs echo",
      name: "echo-test",
      params: z.object({}),
      run: async (_input, ctx) => {
        return await ctx.exec("echo", ["hello"]);
      },
    });

    const result = await Effect.runPromise(p.execute({}));
    expect(result).toEqual({
      isError: false,
      result: JSON.stringify({ exitCode: 0, stderr: "", stdout: "hello\n" }),
    });
  });

  test("captures stderr and non-zero exit code", async () => {
    const p = plugin({
      description: "Tests failure",
      name: "fail-test",
      params: z.object({}),
      run: async (_input, ctx) => {
        return await ctx.exec("sh", ["-c", "echo err >&2; exit 42"]);
      },
    });

    const result = await Effect.runPromise(p.execute({}));
    expect(result).toEqual({
      isError: false,
      result: JSON.stringify({ exitCode: 42, stderr: "err\n", stdout: "" }),
    });
  });

  test("timeout triggers after configured duration", async () => {
    const p = plugin({
      description: "Tests timeout",
      name: "timeout-test",
      params: z.object({}),
      run: async (_input, ctx) => {
        return await ctx.exec("sleep", ["5"], { timeout: 100 });
      },
    });

    const result = await Effect.runPromise(p.execute({}).pipe(Effect.either));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(PluginExecError);
      // The cause should be timeout-related
      const cause = result.left.cause;
      expect(cause).toBeInstanceOf(ExecTimeoutError);
      if (cause instanceof ExecTimeoutError) {
        expect(cause.timeoutMs).toBe(100);
      }
    }
  });

  test("respects cwd option", async () => {
    const p = plugin({
      description: "Tests cwd",
      name: "cwd-test",
      params: z.object({}),
      run: async (_input, ctx) => {
        return await ctx.exec("pwd", [], { cwd: "/tmp" });
      },
    });

    const result = (await Effect.runPromise(p.execute({}))) as { result: string };
    const parsed = JSON.parse(result.result);
    expect(parsed.stdout.trim()).toBe("/tmp");
  });
});

// ---------------------------------------------------------------------------
// PluginCtx.signal — cancellation propagation
// ---------------------------------------------------------------------------

describe("PluginCtx.signal", () => {
  test("signal propagates from Fiber interruption", async () => {
    let signalAborted = false;
    let signalSeen = false;

    const p = plugin({
      description: "Tests signal propagation",
      name: "signal-test",
      params: z.object({}),
      run: async (_input, ctx) => {
        // Listen for abort
        ctx.signal.addEventListener("abort", () => {
          signalAborted = true;
        });
        signalSeen = true;

        // Wait long enough to be interrupted
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return "should not complete";
      },
    });

    const program = Effect.gen(function* () {
      const fiber = yield* Effect.fork(p.execute({}));
      // Wait a bit for the plugin to start
      yield* Effect.sleep("50 millis");
      // Interrupt the fiber
      yield* Fiber.interrupt(fiber);
      // Give time for abort to propagate
      yield* Effect.sleep("50 millis");
      return { signalAborted, signalSeen };
    });

    const result = await Effect.runPromise(program);
    expect(result.signalSeen).toBe(true);
    expect(result.signalAborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PluginCtx.logger
// ---------------------------------------------------------------------------

describe("PluginCtx.logger", () => {
  test("logger is provided to plugin run function", async () => {
    let loggerReceived = false;

    const p = plugin({
      description: "Tests logger",
      name: "logger-test",
      params: z.object({}),
      run: async (_input, ctx) => {
        loggerReceived =
          typeof ctx.logger.info === "function" &&
          typeof ctx.logger.debug === "function" &&
          typeof ctx.logger.warn === "function" &&
          typeof ctx.logger.error === "function";
        return loggerReceived;
      },
    });

    const result = await Effect.runPromise(p.execute({}));
    expect(result).toEqual({ isError: false, result: "true" });
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Consumer code contract: no Effect imports
// ---------------------------------------------------------------------------

describe("Consumer API contract", () => {
  test("plugin() accepts PluginDef with Promise-based run", () => {
    // This test verifies the public API shape — no Effect types required
    const def: PluginDef<z.ZodObject<{ target: z.ZodString }>> = {
      description: "Written by a consumer",
      name: "consumer-plugin",
      params: z.object({
        target: z.string(),
      }),
      run: async (input, ctx) => {
        const result = await ctx.exec("echo", [input.target]);
        return result.stdout.trim();
      },
    };

    const p = plugin(def);
    expect(p.name).toBe("consumer-plugin");
    expect(typeof p.execute).toBe("function");
  });
});
