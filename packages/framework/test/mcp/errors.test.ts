import { describe, expect, it } from "bun:test";
import { McpConfigError, McpSdkLoadError } from "../../src/mcp/errors";

describe("McpSdkLoadError", () => {
  it("should extend Error", () => {
    const error = new McpSdkLoadError("test error");
    expect(error).toBeInstanceOf(Error);
  });

  it("should be instanceof McpSdkLoadError", () => {
    const error = new McpSdkLoadError("test error");
    expect(error).toBeInstanceOf(McpSdkLoadError);
  });

  it("should have correct _tag", () => {
    const error = new McpSdkLoadError("test error");
    expect(error._tag).toBe("McpSdkLoadError");
  });

  it("should have correct name", () => {
    const error = new McpSdkLoadError("test error");
    expect(error.name).toBe("McpSdkLoadError");
  });

  it("should format message with SDK type and error details", () => {
    const error = new McpSdkLoadError("Module not found");
    expect(error.message).toBe("Failed to load MCP SDK: Module not found");
  });

  it("should contain 'Failed to load MCP SDK' substring for test compatibility", () => {
    const error = new McpSdkLoadError("some error");
    expect(() => {
      throw error;
    }).toThrow("Failed to load MCP SDK");
  });
});

describe("McpConfigError", () => {
  it("should extend Error", () => {
    const error = new McpConfigError("URL required for streamable-http transport");
    expect(error).toBeInstanceOf(Error);
  });

  it("should be instanceof McpConfigError", () => {
    const error = new McpConfigError("URL required for streamable-http transport");
    expect(error).toBeInstanceOf(McpConfigError);
  });

  it("should have correct _tag", () => {
    const error = new McpConfigError("URL required for streamable-http transport");
    expect(error._tag).toBe("McpConfigError");
  });

  it("should have correct name", () => {
    const error = new McpConfigError("URL required for streamable-http transport");
    expect(error.name).toBe("McpConfigError");
  });

  it("should format message with config error details", () => {
    const error = new McpConfigError("URL required for streamable-http transport");
    expect(error.message).toBe("URL required for streamable-http transport");
  });

  it("should contain 'URL required' substring for streamable-http transport error", () => {
    const error = new McpConfigError("URL required for streamable-http transport");
    expect(() => {
      throw error;
    }).toThrow("URL required");
  });
});
