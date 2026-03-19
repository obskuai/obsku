import { describe, expect, test } from "bun:test";
import { GuardrailError, runInputGuardrails, runOutputGuardrails } from "../../src/guardrails";
import type { GuardrailFn, Message } from "../../src/types";

describe("runInputGuardrails", () => {
  const createMessage = (): Array<Message> => [
    { content: [{ text: "test", type: "text" }], role: "user" },
  ];

  test("passes when no guardrails configured", async () => {
    await runInputGuardrails("hello", [], createMessage());
  });

  test("passes when all guardrails allow", async () => {
    const guardrails: Array<GuardrailFn> = [() => ({ allow: true }), () => ({ allow: true })];
    await runInputGuardrails("hello", guardrails, createMessage());
  });

  test("throws GuardrailError when guardrail blocks", async () => {
    const guardrails: Array<GuardrailFn> = [() => ({ allow: false, reason: "blocked" })];
    await expect(runInputGuardrails("hello", guardrails, createMessage())).rejects.toThrow(
      GuardrailError
    );
  });

  test("error contains reason", async () => {
    const guardrails: Array<GuardrailFn> = [
      () => ({ allow: false, reason: "sensitive content detected" }),
    ];
    try {
      await runInputGuardrails("hello", guardrails, createMessage());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GuardrailError);
      const err = error as GuardrailError;
      expect(err.reason).toBe("sensitive content detected");
      expect(err._tag).toBe("GuardrailError");
    }
  });

  test("stops at first blocking guardrail", async () => {
    let secondCalled = false;
    const guardrails: Array<GuardrailFn> = [
      () => ({ allow: false, reason: "first" }),
      () => {
        secondCalled = true;
        return { allow: true };
      },
    ];
    await expect(runInputGuardrails("hello", guardrails, createMessage())).rejects.toThrow();
    expect(secondCalled).toBe(false);
  });

  test("runs sequentially", async () => {
    const order: Array<number> = [];
    const guardrails: Array<GuardrailFn> = [
      () => {
        order.push(1);
        return { allow: true };
      },
      () => {
        order.push(2);
        return { allow: true };
      },
      () => {
        order.push(3);
        return { allow: true };
      },
    ];
    await runInputGuardrails("hello", guardrails, createMessage());
    expect(order).toEqual([1, 2, 3]);
  });

  test("supports async guardrails", async () => {
    const guardrails: Array<GuardrailFn> = [
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { allow: true };
      },
    ];
    await runInputGuardrails("hello", guardrails, createMessage());
  });

  test("async guardrail can block", async () => {
    const guardrails: Array<GuardrailFn> = [
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { allow: false, reason: "async block" };
      },
    ];
    await expect(runInputGuardrails("hello", guardrails, createMessage())).rejects.toThrow(
      GuardrailError
    );
  });

  test("passes input and messages to guardrail", async () => {
    let receivedInput: string | undefined;
    let receivedMessages: Message[] | undefined;
    const messages = createMessage();
    const guardrails: Array<GuardrailFn> = [
      (ctx) => {
        receivedInput = ctx.input;
        receivedMessages = ctx.messages;
        return { allow: true };
      },
    ];
    await runInputGuardrails("test input", guardrails, messages);
    expect(receivedInput).toBe("test input");
    expect(receivedMessages).toBe(messages);
  });
});

describe("runOutputGuardrails", () => {
  const createMessage = (): Array<Message> => [
    { content: [{ text: "test", type: "text" }], role: "user" },
  ];

  test("passes when no guardrails configured", async () => {
    await runOutputGuardrails("output", [], createMessage());
  });

  test("passes when all guardrails allow", async () => {
    const guardrails: Array<GuardrailFn> = [() => ({ allow: true }), () => ({ allow: true })];
    await runOutputGuardrails("output", guardrails, createMessage());
  });

  test("throws GuardrailError when guardrail blocks", async () => {
    const guardrails: Array<GuardrailFn> = [
      () => ({ allow: false, reason: "inappropriate content" }),
    ];
    await expect(runOutputGuardrails("output", guardrails, createMessage())).rejects.toThrow(
      GuardrailError
    );
  });

  test("stops at first blocking guardrail", async () => {
    let secondCalled = false;
    const guardrails: Array<GuardrailFn> = [
      () => ({ allow: false, reason: "first" }),
      () => {
        secondCalled = true;
        return { allow: true };
      },
    ];
    await expect(runOutputGuardrails("output", guardrails, createMessage())).rejects.toThrow();
    expect(secondCalled).toBe(false);
  });

  test("passes output and messages to guardrail", async () => {
    let receivedOutput: string | undefined;
    let receivedMessages: Message[] | undefined;
    const messages = createMessage();
    const guardrails: Array<GuardrailFn> = [
      (ctx) => {
        receivedOutput = ctx.output;
        receivedMessages = ctx.messages;
        return { allow: true };
      },
    ];
    await runOutputGuardrails("test output", guardrails, messages);
    expect(receivedOutput).toBe("test output");
    expect(receivedMessages).toBe(messages);
  });
});

describe("GuardrailError", () => {
  test("has correct name", () => {
    const error = new GuardrailError("test reason");
    expect(error.name).toBe("GuardrailError");
  });

  test("has correct _tag", () => {
    const error = new GuardrailError("test reason");
    expect(error._tag).toBe("GuardrailError");
  });

  test("message includes reason", () => {
    const error = new GuardrailError("test reason");
    expect(error.message).toContain("test reason");
  });
});
