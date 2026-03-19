import { describe, expect, it } from "bun:test";
import { TaskConcurrencyError } from "../../src/background/errors";

describe("TaskConcurrencyError", () => {
  it("should extend Error", () => {
    const error = new TaskConcurrencyError(10);
    expect(error).toBeInstanceOf(Error);
  });

  it("should be instanceof TaskConcurrencyError", () => {
    const error = new TaskConcurrencyError(10);
    expect(error).toBeInstanceOf(TaskConcurrencyError);
  });

  it("should have correct _tag", () => {
    const error = new TaskConcurrencyError(10);
    expect(error._tag).toBe("TaskConcurrencyError");
  });

  it("should have correct name", () => {
    const error = new TaskConcurrencyError(10);
    expect(error.name).toBe("TaskConcurrencyError");
  });

  it("should format message with max concurrent count", () => {
    const error = new TaskConcurrencyError(10);
    expect(error.message).toBe("Max concurrent background tasks (10) reached");
  });

  it("should work with different concurrency limits", () => {
    const error = new TaskConcurrencyError(5);
    expect(error.message).toBe("Max concurrent background tasks (5) reached");
  });

  it("should contain 'Max concurrent' substring for test compatibility", () => {
    const error = new TaskConcurrencyError(10);
    expect(() => {
      throw error;
    }).toThrow("Max concurrent");
  });

  it("should contain maxConcurrent value in message", () => {
    const error = new TaskConcurrencyError(25);
    expect(error.message).toContain("25");
  });
});
