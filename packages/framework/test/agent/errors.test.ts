import { describe, expect, it } from "bun:test";
import { AgentRecursionError, AgentValidationError } from "../../src/agent/errors";

describe("AgentValidationError", () => {
  it("should extend Error", () => {
    const error = new AgentValidationError("task", "number");
    expect(error).toBeInstanceOf(Error);
  });

  it("should be instanceof AgentValidationError", () => {
    const error = new AgentValidationError("task", "number");
    expect(error).toBeInstanceOf(AgentValidationError);
  });

  it("should have correct _tag", () => {
    const error = new AgentValidationError("task", "number");
    expect(error._tag).toBe("AgentValidationError");
  });

  it("should have correct name", () => {
    const error = new AgentValidationError("task", "number");
    expect(error.name).toBe("AgentValidationError");
  });

  it("should format message with field name and actual type", () => {
    const error = new AgentValidationError("task", "number");
    expect(error.message).toBe('Invalid input: expected "task" to be a string, got number');
  });

  it("should handle different field names", () => {
    const error = new AgentValidationError("input", "object");
    expect(error.message).toBe('Invalid input: expected "input" to be a string, got object');
  });

  it("should contain 'Invalid input' substring for test compatibility", () => {
    const error = new AgentValidationError("task", "undefined");
    expect(() => {
      throw error;
    }).toThrow("Invalid input");
  });

  it("should contain field name in message", () => {
    const error = new AgentValidationError("task", "number");
    expect(error.message).toContain("task");
  });
});

describe("AgentRecursionError", () => {
  it("should extend Error", () => {
    const error = new AgentRecursionError(5);
    expect(error).toBeInstanceOf(Error);
  });

  it("should be instanceof AgentRecursionError", () => {
    const error = new AgentRecursionError(5);
    expect(error).toBeInstanceOf(AgentRecursionError);
  });

  it("should have correct _tag", () => {
    const error = new AgentRecursionError(5);
    expect(error._tag).toBe("AgentRecursionError");
  });

  it("should have correct name", () => {
    const error = new AgentRecursionError(5);
    expect(error.name).toBe("AgentRecursionError");
  });

  it("should format message with max depth and recursion warning", () => {
    const error = new AgentRecursionError(5);
    expect(error.message).toBe(
      "Maximum agent delegation depth (5) exceeded. This may indicate an infinite recursion loop."
    );
  });

  it("should work with different depth limits", () => {
    const error = new AgentRecursionError(10);
    expect(error.message).toBe(
      "Maximum agent delegation depth (10) exceeded. This may indicate an infinite recursion loop."
    );
  });

  it("should contain 'Maximum agent delegation depth' substring for test compatibility", () => {
    const error = new AgentRecursionError(5);
    expect(() => {
      throw error;
    }).toThrow("Maximum agent delegation depth");
  });

  it("should contain 'infinite recursion' substring for test compatibility", () => {
    const error = new AgentRecursionError(5);
    expect(() => {
      throw error;
    }).toThrow("infinite recursion");
  });

  it("should contain maxDepth value in message", () => {
    const error = new AgentRecursionError(3);
    expect(error.message).toContain("3");
  });
});
