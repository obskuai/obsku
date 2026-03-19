import { describe, expect, it } from "bun:test";
import { buildClaudeInvocationConfig, CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS } from "../src/config";
import type { ClaudeCodePluginConfig } from "../src/types";

describe("buildClaudeInvocationConfig", () => {
  describe("args array generation", () => {
    it("should generate correct CLI args array", () => {
      const config: ClaudeCodePluginConfig = {};
      const result = buildClaudeInvocationConfig(config);

      expect(result.cliArgs).toEqual([
        "--allowedTools",
        expect.any(String),
        "--permission-prompt-tool",
        expect.any(String),
        "--mcp-config",
        expect.any(String),
      ]);
    });

    it("should include allowed tools as comma-separated string", () => {
      const config: ClaudeCodePluginConfig = {};
      const result = buildClaudeInvocationConfig(config);

      const allowedToolsArg = result.cliArgs[1];
      expect(typeof allowedToolsArg).toBe("string");
      expect(allowedToolsArg).toContain("Edit");
      expect(allowedToolsArg).toContain("Read");
    });

    it("should include mcp-config as JSON string", () => {
      const config: ClaudeCodePluginConfig = {};
      const result = buildClaudeInvocationConfig(config);

      const mcpConfigArg = result.cliArgs[5];
      expect(() => JSON.parse(mcpConfigArg)).not.toThrow();
      const parsed = JSON.parse(mcpConfigArg);
      expect(parsed.mcpServers).toBeDefined();
      expect(parsed.mcpServers.obsku).toBeDefined();
    });
  });

  describe("default allowed tools", () => {
    it("should not include Bash in default allowed tools", () => {
      expect(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS).not.toContain("Bash");
      expect(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS).not.toContain("bash");
    });

    it("should include safe default tools", () => {
      expect(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS).toContain("Edit");
      expect(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS).toContain("Read");
      expect(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS).toContain("Write");
      expect(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS).toContain("Glob");
      expect(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS).toContain("Grep");
      expect(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS).toContain("LS");
      expect(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS).toContain("Task");
    });

    it("should have reasonable number of default tools", () => {
      expect(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS.length).toBeGreaterThanOrEqual(10);
      expect(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS.length).toBeLessThanOrEqual(20);
    });
  });

  describe("extraTools merging", () => {
    it("should add extra tools to allowed tools", () => {
      const config: ClaudeCodePluginConfig = {
        extraTools: ["Bash", "WebSearch"],
      };
      const result = buildClaudeInvocationConfig(config);

      expect(result.allowedTools).toContain("Bash");
      expect(result.allowedTools).toContain("WebSearch");
      // Should still have defaults
      expect(result.allowedTools).toContain("Edit");
      expect(result.allowedTools).toContain("Read");
    });

    it("should be additive (not replace defaults)", () => {
      const config: ClaudeCodePluginConfig = {
        extraTools: ["CustomTool"],
      };
      const result = buildClaudeInvocationConfig(config);

      const defaultCount = CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS.length;
      expect(result.allowedTools.length).toBe(defaultCount + 1);
      expect(result.allowedTools).toContain("CustomTool");
    });

    it("should handle empty extraTools array", () => {
      const config: ClaudeCodePluginConfig = {
        extraTools: [],
      };
      const result = buildClaudeInvocationConfig(config);

      expect(result.allowedTools).toEqual(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS as unknown as Array<string>);
    });

    it("should deduplicate extra tools", () => {
      const config: ClaudeCodePluginConfig = {
        extraTools: ["Edit", "Read", "Edit"], // Edit is in defaults
      };
      const result = buildClaudeInvocationConfig(config);

      const editCount = result.allowedTools.filter((t) => t === "Edit").length;
      expect(editCount).toBe(1);
    });

    it("should trim whitespace from extra tools", () => {
      const config: ClaudeCodePluginConfig = {
        extraTools: ["  Bash  ", " WebSearch "],
      };
      const result = buildClaudeInvocationConfig(config);

      expect(result.allowedTools).toContain("Bash");
      expect(result.allowedTools).toContain("WebSearch");
      expect(result.allowedTools).not.toContain("  Bash  ");
    });
  });

  describe("extraMcpServers merging", () => {
    it("should add extra MCP servers", () => {
      const config: ClaudeCodePluginConfig = {
        extraMcpServers: {
          custom: {
            args: ["server.js"],
            command: "node",
            type: "stdio",
          },
        },
      };
      const result = buildClaudeInvocationConfig(config);

      expect(result.mcpConfig.mcpServers.custom).toBeDefined();
      expect(result.mcpConfig.mcpServers.custom.command).toBe("node");
    });

    it("should be additive (not replace default obsku server)", () => {
      const config: ClaudeCodePluginConfig = {
        extraMcpServers: {
          custom: {
            args: ["server.js"],
            command: "node",
            type: "stdio",
          },
        },
      };
      const result = buildClaudeInvocationConfig(config);

      expect(result.mcpConfig.mcpServers.obsku).toBeDefined();
      expect(result.mcpConfig.mcpServers.custom).toBeDefined();
    });

    it("should handle HTTP transport MCP servers", () => {
      const config: ClaudeCodePluginConfig = {
        extraMcpServers: {
          httpServer: {
            command: "npx",
            transport: "streamable-http",
            url: "http://localhost:3000/mcp",
          },
        },
      };
      const result = buildClaudeInvocationConfig(config);

      expect(result.mcpConfig.mcpServers.httpServer).toBeDefined();
      expect(result.mcpConfig.mcpServers.httpServer.transport).toBe("streamable-http");
      expect(result.mcpConfig.mcpServers.httpServer.url).toBe("http://localhost:3000/mcp");
    });

    it("should handle empty extraMcpServers", () => {
      const config: ClaudeCodePluginConfig = {
        extraMcpServers: {},
      };
      const result = buildClaudeInvocationConfig(config);

      expect(Object.keys(result.mcpConfig.mcpServers)).toHaveLength(1);
      expect(result.mcpConfig.mcpServers.obsku).toBeDefined();
    });
  });

  describe("cwd precedence", () => {
    it("should use factoryConfig.cwd when runParams.cwd not provided", () => {
      const config: ClaudeCodePluginConfig = {
        cwd: "/factory/path",
      };
      const result = buildClaudeInvocationConfig(config);

      expect(result.cwd).toBe("/factory/path");
    });

    it("should use runParams.cwd when provided", () => {
      const config: ClaudeCodePluginConfig = {
        cwd: "/factory/path",
      };
      const result = buildClaudeInvocationConfig(config, {
        cwd: "/run/path",
      });

      expect(result.cwd).toBe("/run/path");
    });

    it("should use runParams.cwd over factoryConfig.cwd", () => {
      const config: ClaudeCodePluginConfig = {
        cwd: "/factory/path",
      };
      const result = buildClaudeInvocationConfig(config, {
        cwd: "/run/path",
      });

      expect(result.cwd).toBe("/run/path");
      expect(result.cwd).not.toBe("/factory/path");
    });

    it("should allow undefined cwd", () => {
      const config: ClaudeCodePluginConfig = {};
      const result = buildClaudeInvocationConfig(config);

      expect(result.cwd).toBeUndefined();
    });
  });

  describe("timeout", () => {
    it("should use default timeout of 5 minutes", () => {
      const config: ClaudeCodePluginConfig = {};
      const result = buildClaudeInvocationConfig(config);

      expect(result.timeoutMs).toBe(300_000);
    });
  });

  describe("permission prompt tool", () => {
    it("should generate correct permission prompt tool name", () => {
      const config: ClaudeCodePluginConfig = {};
      const result = buildClaudeInvocationConfig(config);

      expect(result.permissionPromptTool).toBe("mcp__obsku__approval_prompt");
    });
  });
});
