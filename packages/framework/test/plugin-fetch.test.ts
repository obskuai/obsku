import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { z } from "zod";
import { plugin } from "../src/plugin";

// Local Bun server replacing external httpbin.org dependency
let localServer: ReturnType<typeof Bun.serve>;
let localServerUrl: string;

beforeAll(() => {
  localServer = Bun.serve({
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/get") {
        return new Response(JSON.stringify({ method: req.method, url: req.url }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return new Response("Not Found", { status: 404 });
    },
    port: 0, // OS-assigned port
  });
  localServerUrl = `http://localhost:${localServer.port}`;
});

afterAll(() => {
  localServer.stop(true);
});

describe("PluginCtx.fetch", () => {
  test("fetch method exists on ctx", async () => {
    const testPlugin = plugin({
      description: "Test fetch exists",
      name: "fetch-exists-test",
      params: z.object({}),
      run: async (_input, ctx) => {
        return typeof ctx.fetch === "function";
      },
    });

    const result = (await Effect.runPromise(testPlugin.execute({}))) as {
      result: string;
    };
    expect(result.result).toBe("true");
  });

  test("fetch returns Response object", async () => {
    const testPlugin = plugin({
      description: "Test fetch returns Response",
      name: "fetch-response-test",
      params: z.object({}),
      run: async (_input, ctx) => {
        const response = await ctx.fetch(`${localServerUrl}/get`);
        return {
          hasBody: response.body !== null,
          ok: response.ok,
          status: response.status,
        };
      },
    });

    const result = (await Effect.runPromise(testPlugin.execute({}))) as {
      result: string;
    };
    const parsed = JSON.parse(result.result);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe(200);
    expect(parsed.hasBody).toBe(true);
  });

  test("fetch respects signal abort", async () => {
    let signalAborted = false;
    let signalSeen = false;

    const testPlugin = plugin({
      description: "Test signal abort propagation",
      name: "fetch-abort-test",
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
      const fiber = yield* Effect.fork(testPlugin.execute({}));
      // Wait a bit for the plugin to start
      yield* Effect.sleep("50 millis");
      // Interrupt the fiber (this should propagate to the signal)
      yield* Fiber.interrupt(fiber);
      // Give time for abort to propagate
      yield* Effect.sleep("50 millis");
      return { signalAborted, signalSeen };
    });

    const result = await Effect.runPromise(program);
    expect(result.signalSeen).toBe(true);
    expect(result.signalAborted).toBe(true);
  });

  test("fetch timeout rejects when request takes too long", async () => {
    const testPlugin = plugin({
      description: "Test fetch timeout",
      name: "fetch-timeout-test",
      params: z.object({}),
      run: async (_input, ctx) => {
        try {
          // Use a non-routable IP address that will timeout
          // 192.0.2.1 is TEST-NET-1 (RFC 5737) - should not be routable
          const response = await ctx.fetch("http://192.0.2.1:9999/slow", {
            timeout: 100, // Very short timeout
          });
          return { completed: true, status: response.status };
        } catch (error) {
          return {
            errorMessage: error instanceof Error ? error.message : String(error),
            timedOut: true,
          };
        }
      },
    });

    const result = (await Effect.runPromise(testPlugin.execute({}))) as {
      result: string;
    };
    const parsed = JSON.parse(result.result);
    expect(parsed.timedOut).toBe(true);
  });

  test("fetch successful with short timeout for fast endpoint", async () => {
    const testPlugin = plugin({
      description: "Test fetch with short timeout on fast endpoint",
      name: "fetch-fast-timeout-test",
      params: z.object({}),
      run: async (_input, ctx) => {
        try {
          // local server responds instantly
          const response = await ctx.fetch(`${localServerUrl}/get`, {
            timeout: 5000, // 5 second timeout, plenty for local
          });
          return {
            completed: true,
            ok: response.ok,
            status: response.status,
          };
        } catch (error) {
          return {
            error: true,
            errorMessage: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });

    const result = (await Effect.runPromise(testPlugin.execute({}))) as {
      result: string;
    };
    const parsed = JSON.parse(result.result);
    expect(parsed.completed).toBe(true);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe(200);
  });
});
