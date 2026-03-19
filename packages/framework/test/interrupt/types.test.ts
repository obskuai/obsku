import { describe, expect, test } from "bun:test";
import { type InterruptConfig, InterruptError, interrupt } from "../../src/interrupt/types";

describe("InterruptError", () => {
  test("InterruptError has _tag", () => {
    const error = new InterruptError({ reason: "test" });
    expect(error._tag).toBe("InterruptError");
  });

  test("InterruptError extends Error", () => {
    const error = new InterruptError({ reason: "test" });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(InterruptError);
  });

  test("InterruptError stores config", () => {
    const config: InterruptConfig = {
      metadata: { key: "value" },
      reason: "need-input",
      requiresInput: true,
      timeout: 5000,
    };
    const error = new InterruptError(config);
    expect(error.config).toBe(config);
    expect(error.config.reason).toBe("need-input");
    expect(error.config.requiresInput).toBe(true);
    expect(error.config.timeout).toBe(5000);
    expect(error.config.metadata).toEqual({ key: "value" });
  });

  test("InterruptError message includes reason", () => {
    const error = new InterruptError({ reason: "waiting for user" });
    expect(error.message).toBe("Interrupt: waiting for user");
  });

  test("InterruptError name is set", () => {
    const error = new InterruptError({ reason: "test" });
    expect(error.name).toBe("InterruptError");
  });
});

describe("interrupt()", () => {
  test("interrupt() throws InterruptError", () => {
    expect(() => interrupt({ reason: "test" })).toThrow(InterruptError);
  });

  test("interrupt() throws with correct message", () => {
    expect(() => interrupt({ reason: "pause execution" })).toThrow("Interrupt: pause execution");
  });

  test("interrupt() throws with config", () => {
    let caught = false;
    try {
      interrupt({ reason: "test", requiresInput: true });
    } catch (error) {
      caught = true;
      expect(error).toBeInstanceOf(InterruptError);
      if (error instanceof InterruptError) {
        expect(error.config.requiresInput).toBe(true);
      }
    }
    expect(caught).toBe(true);
  });
});

describe("InterruptConfig", () => {
  test("only reason is required", () => {
    const config: InterruptConfig = { reason: "test" };
    expect(config.reason).toBe("test");
    expect(config.requiresInput).toBeUndefined();
    expect(config.timeout).toBeUndefined();
    expect(config.metadata).toBeUndefined();
  });

  test("all fields can be set", () => {
    const config: InterruptConfig = {
      metadata: { checkpoint: "abc123" },
      reason: "full config",
      requiresInput: true,
      timeout: 10_000,
    };
    expect(config.reason).toBe("full config");
    expect(config.requiresInput).toBe(true);
    expect(config.timeout).toBe(10_000);
    expect(config.metadata).toEqual({ checkpoint: "abc123" });
  });
});

describe("Type guards", () => {
  test("instanceof InterruptError works", () => {
    const error = new InterruptError({ reason: "test" });
    expect(error instanceof InterruptError).toBe(true);
  });

  test("instanceof Error works", () => {
    const error = new InterruptError({ reason: "test" });
    expect(error instanceof Error).toBe(true);
  });

  test("_tag property for type discrimination", () => {
    const error = new InterruptError({ reason: "test" });
    expect(error._tag).toBe("InterruptError");
    expect(error.config).toBeDefined();
  });
});
