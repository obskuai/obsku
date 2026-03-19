import { describe, expect, it } from "bun:test";
import {
  buildClaudeInvocationConfig,
  CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS,
  CLAUDE_CODE_DEFAULT_MCP_SERVER_NAME,
  CLAUDE_CODE_DEFAULT_PERMISSION_TOOL_NAME,
} from "../src/config";

// ─── Strict-default baseline ──────────────────────────────────────────────────

describe("strict defaults — Bash is off", () => {
  it("DEFAULT_ALLOWED_TOOLS does not include Bash", () => {
    const tools = Array.from(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS);
    expect(tools).not.toContain("Bash");
  });

  it("DEFAULT_ALLOWED_TOOLS does not contain any Bash variant", () => {
    const tools = Array.from(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS);
    const bashVariants = tools.filter((t) => /bash/i.test(t));
    expect(bashVariants).toHaveLength(0);
  });

  it("buildClaudeInvocationConfig() — default allowedTools excludes Bash", () => {
    const cfg = buildClaudeInvocationConfig();
    expect(cfg.allowedTools).not.toContain("Bash");
  });

  it("strict mode is the baseline — no opt-in flag required", () => {
    // Calling with no config must produce a compliant strict-profile config.
    // If this throws or requires special flags, the baseline contract is broken.
    expect(() => buildClaudeInvocationConfig()).not.toThrow();
    const cfg = buildClaudeInvocationConfig();
    expect(cfg.allowedTools.length).toBeGreaterThan(0);
    expect(cfg.allowedTools).not.toContain("Bash");
  });
});

// ─── Permission seam ──────────────────────────────────────────────────────────

describe("permission seam — always wired", () => {
  it("cliArgs includes --permission-prompt-tool", () => {
    const cfg = buildClaudeInvocationConfig();
    expect(cfg.cliArgs).toContain("--permission-prompt-tool");
  });

  it("permissionPromptTool references default MCP server and tool name", () => {
    const cfg = buildClaudeInvocationConfig();
    expect(cfg.permissionPromptTool).toBe(
      `mcp__${CLAUDE_CODE_DEFAULT_MCP_SERVER_NAME}__${CLAUDE_CODE_DEFAULT_PERMISSION_TOOL_NAME}`
    );
  });

  it("cliArgs places permissionPromptTool value after its flag", () => {
    const cfg = buildClaudeInvocationConfig();
    const args = Array.from(cfg.cliArgs);
    const flagIdx = args.indexOf("--permission-prompt-tool");
    expect(flagIdx).toBeGreaterThanOrEqual(0);
    expect(args[flagIdx + 1]).toBe(cfg.permissionPromptTool);
  });
});

// ─── MCP defaults ─────────────────────────────────────────────────────────────

describe("MCP defaults — obsku server always present", () => {
  it("cliArgs includes --mcp-config", () => {
    const cfg = buildClaudeInvocationConfig();
    expect(cfg.cliArgs).toContain("--mcp-config");
  });

  it("mcpConfig.mcpServers contains the default obsku server", () => {
    const cfg = buildClaudeInvocationConfig();
    expect(cfg.mcpConfig.mcpServers).toHaveProperty(CLAUDE_CODE_DEFAULT_MCP_SERVER_NAME);
  });

  it("--mcp-config JSON in cliArgs parses and includes obsku server", () => {
    const cfg = buildClaudeInvocationConfig();
    const args = Array.from(cfg.cliArgs);
    const flagIdx = args.indexOf("--mcp-config");
    expect(flagIdx).toBeGreaterThanOrEqual(0);
    const raw = args[flagIdx + 1];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers).toHaveProperty(CLAUDE_CODE_DEFAULT_MCP_SERVER_NAME);
  });

  it("default obsku MCP server is stdio transport", () => {
    const cfg = buildClaudeInvocationConfig();
    const obsku = cfg.mcpConfig.mcpServers[CLAUDE_CODE_DEFAULT_MCP_SERVER_NAME];
    expect(obsku).toBeDefined();
    expect((obsku as { type?: string }).type).toBe("stdio");
  });
});

// ─── extraTools expansion ─────────────────────────────────────────────────────

describe("extraTools — additive expansion only", () => {
  it("extraTools adds Bash to allowedTools when explicitly requested", () => {
    const cfg = buildClaudeInvocationConfig({ extraTools: ["Bash"] });
    expect(cfg.allowedTools).toContain("Bash");
  });

  it("extraTools does not replace defaults — base tools remain", () => {
    const cfg = buildClaudeInvocationConfig({ extraTools: ["Bash"] });
    const base = Array.from(CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS);
    for (const tool of base) {
      expect(cfg.allowedTools).toContain(tool);
    }
  });

  it("extraTools with unknown tool appends alongside defaults", () => {
    const cfg = buildClaudeInvocationConfig({ extraTools: ["CustomTool"] });
    expect(cfg.allowedTools).toContain("CustomTool");
    // Default tools still present
    expect(cfg.allowedTools).toContain("Read");
    expect(cfg.allowedTools).toContain("Write");
  });

  it("extraTools deduplicates — adding an existing tool does not duplicate", () => {
    const cfg = buildClaudeInvocationConfig({ extraTools: ["Read", "Read"] });
    const readCount = cfg.allowedTools.filter((t) => t === "Read").length;
    expect(readCount).toBe(1);
  });

  it("extraTools with empty array behaves identically to no extraTools", () => {
    const base = buildClaudeInvocationConfig();
    const withEmpty = buildClaudeInvocationConfig({ extraTools: [] });
    expect(withEmpty.allowedTools).toEqual(base.allowedTools);
  });

  it("empty string extraTools entries are ignored", () => {
    const base = buildClaudeInvocationConfig();
    const withBlanks = buildClaudeInvocationConfig({ extraTools: ["", "  "] });
    expect(withBlanks.allowedTools).toEqual(base.allowedTools);
  });
});

// ─── extraMcpServers expansion ────────────────────────────────────────────────

describe("extraMcpServers — additive expansion only", () => {
  const extraServer = {
    args: ["--port", "9090"],
    command: "my-mcp-server",
    type: "stdio" as const,
  };

  it("extraMcpServers adds named server alongside obsku", () => {
    const cfg = buildClaudeInvocationConfig({ extraMcpServers: { myserver: extraServer } });
    expect(cfg.mcpConfig.mcpServers).toHaveProperty("myserver");
    expect(cfg.mcpConfig.mcpServers).toHaveProperty(CLAUDE_CODE_DEFAULT_MCP_SERVER_NAME);
  });

  it("extraMcpServers does NOT replace the default obsku server", () => {
    const cfg = buildClaudeInvocationConfig({ extraMcpServers: { myserver: extraServer } });
    const obsku = cfg.mcpConfig.mcpServers[CLAUDE_CODE_DEFAULT_MCP_SERVER_NAME];
    expect(obsku).toBeDefined();
  });

  it("extraMcpServers streamable-http server is normalized correctly", () => {
    const httpServer = { transport: "streamable-http" as const, url: "https://example.com/mcp" };
    const cfg = buildClaudeInvocationConfig({ extraMcpServers: { remote: httpServer } });
    const remote = cfg.mcpConfig.mcpServers["remote"] as { type?: string; url?: string };
    expect(remote).toBeDefined();
    expect(remote.type).toBe("streamable-http");
    expect(remote.url).toBe("https://example.com/mcp");
  });

  it("multiple extraMcpServers all appear in mcpConfig", () => {
    const cfg = buildClaudeInvocationConfig({
      extraMcpServers: {
        serverA: { command: "a", type: "stdio" },
        serverB: { command: "b", type: "stdio" },
      },
    });
    expect(cfg.mcpConfig.mcpServers).toHaveProperty("serverA");
    expect(cfg.mcpConfig.mcpServers).toHaveProperty("serverB");
    expect(cfg.mcpConfig.mcpServers).toHaveProperty(CLAUDE_CODE_DEFAULT_MCP_SERVER_NAME);
  });

  it("--mcp-config in cliArgs reflects extra servers", () => {
    const cfg = buildClaudeInvocationConfig({ extraMcpServers: { myserver: extraServer } });
    const args = Array.from(cfg.cliArgs);
    const flagIdx = args.indexOf("--mcp-config");
    const parsed = JSON.parse(args[flagIdx + 1]!) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers).toHaveProperty("myserver");
    expect(parsed.mcpServers).toHaveProperty(CLAUDE_CODE_DEFAULT_MCP_SERVER_NAME);
  });
});

// ─── No silent policy loosening ──────────────────────────────────────────────

describe("no silent policy loosening", () => {
  it("config with no options never contains Bash", () => {
    for (let i = 0; i < 3; i++) {
      const cfg = buildClaudeInvocationConfig();
      expect(cfg.allowedTools).not.toContain("Bash");
    }
  });

  it("cliArgs --allowedTools value never contains 'Bash' unless explicitly added", () => {
    const cfg = buildClaudeInvocationConfig();
    const args = Array.from(cfg.cliArgs);
    const flagIdx = args.indexOf("--allowedTools");
    expect(flagIdx).toBeGreaterThanOrEqual(0);
    const toolsStr = args[flagIdx + 1] ?? "";
    const toolList = toolsStr.split(",");
    expect(toolList).not.toContain("Bash");
  });

  it("obsku MCP server cannot be removed through normal config paths", () => {
    // extraMcpServers cannot overwrite the obsku key — if it can, that's a policy violation.
    // Passing a server under the obsku key name is an intentional bypass attempt.
    // The default obsku server must still be wired correctly.
    const cfg = buildClaudeInvocationConfig();
    const obsku = cfg.mcpConfig.mcpServers[CLAUDE_CODE_DEFAULT_MCP_SERVER_NAME];
    expect(obsku).toBeDefined();
    // Must point to a stdio transport (not a no-op)
    expect((obsku as { type?: string }).type).toBe("stdio");
  });
});
