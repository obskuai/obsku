import { describe, expect, it } from "bun:test";
import { MultiAgentConfigError } from "../../src/multi-agent/errors";

describe("MultiAgentConfigError", () => {
  it("should extend Error", () => {
    const error = new MultiAgentConfigError("Empty crew");
    expect(error).toBeInstanceOf(Error);
  });

  it("should be instanceof MultiAgentConfigError", () => {
    const error = new MultiAgentConfigError("Empty crew");
    expect(error).toBeInstanceOf(MultiAgentConfigError);
  });

  it("should have correct _tag", () => {
    const error = new MultiAgentConfigError("Empty crew");
    expect(error._tag).toBe("MultiAgentConfigError");
  });

  it("should have correct name", () => {
    const error = new MultiAgentConfigError("Empty crew");
    expect(error.name).toBe("MultiAgentConfigError");
  });

  it("should format message for empty crew error", () => {
    const error = new MultiAgentConfigError("Empty crew");
    expect(error.message).toBe("Empty crew");
  });

  it("should format message for empty supervisor workers error", () => {
    const error = new MultiAgentConfigError("Supervisor requires at least one worker");
    expect(error.message).toBe("Supervisor requires at least one worker");
  });

  it("should contain 'Empty crew' substring for crew validation", () => {
    const error = new MultiAgentConfigError("Empty crew");
    expect(() => {
      throw error;
    }).toThrow("Empty crew");
  });

  it("should contain 'Supervisor requires' substring for supervisor validation", () => {
    const error = new MultiAgentConfigError("Supervisor requires at least one worker");
    expect(() => {
      throw error;
    }).toThrow("Supervisor requires");
  });
});
