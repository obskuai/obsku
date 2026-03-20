import type { ClaudeCodeMcpServerConfig, ClaudeCodePluginConfig } from "./types";

const DEFAULT_ALLOWED_TOOLS = [
  "Edit",
  "Glob",
  "Grep",
  "LS",
  "MultiEdit",
  "NotebookEdit",
  "NotebookRead",
  "Read",
  "Task",
  "TodoWrite",
  "WebFetch",
  "Write",
] as const;

const DEFAULT_PERMISSION_MCP_SERVER_NAME = "obsku";
const DEFAULT_PERMISSION_TOOL_NAME = "approval_prompt";

type ClaudeCliMcpServerConfig = {
  readonly args?: ReadonlyArray<string>;
  readonly command?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly transport?: "stdio" | "streamable-http";
  readonly type?: "stdio" | "streamable-http";
  readonly url?: string;
};

export interface ClaudeCliMcpConfig {
  readonly mcpServers: Readonly<Record<string, ClaudeCliMcpServerConfig>>;
}

export interface ClaudeInvocationConfig {
  readonly allowedTools: ReadonlyArray<string>;
  readonly cliArgs: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly mcpConfig: ClaudeCliMcpConfig;
  readonly permissionPromptTool: string;
  readonly timeoutMs: number;
}

function normalizeAllowedTools(extraTools: ReadonlyArray<string> | undefined): Array<string> {
  const merged = new Set<string>(DEFAULT_ALLOWED_TOOLS);
  for (const tool of extraTools ?? []) {
    const trimmed = tool.trim();
    if (trimmed.length > 0) {
      merged.add(trimmed);
    }
  }
  return Array.from(merged);
}

function normalizeMcpServerConfig(server: ClaudeCodeMcpServerConfig): ClaudeCliMcpServerConfig {
  const transport = server.transport ?? server.type ?? (server.url ? "streamable-http" : "stdio");

  if (transport === "streamable-http") {
    return {
      transport,
      type: "streamable-http",
      url: server.url,
    };
  }

  return {
    args: server.args,
    command: server.command,
    env: server.env,
    transport: "stdio",
    type: "stdio",
  };
}

function createDefaultObskuMcpServer(): ClaudeCodeMcpServerConfig {
  return {
    args: ["--bun", "opencode", "serve"],
    command: "bunx",
    env: {
      OBSKU_CLAUDE_CODE_PERMISSION_TOOL: DEFAULT_PERMISSION_TOOL_NAME,
      OBSKU_CLAUDE_CODE_STRICT_DEFAULTS: "1",
    },
    type: "stdio",
  };
}

export function buildClaudeInvocationConfig(
  config: ClaudeCodePluginConfig = {},
  params?: {
    readonly cwd?: string;
  }
): ClaudeInvocationConfig {
  const mcpServers: Record<string, ClaudeCliMcpServerConfig> = {
    [DEFAULT_PERMISSION_MCP_SERVER_NAME]: normalizeMcpServerConfig(createDefaultObskuMcpServer()),
  };

  for (const [name, server] of Object.entries(config.extraMcpServers ?? {})) {
    mcpServers[name] = normalizeMcpServerConfig(server);
  }

  const allowedTools = normalizeAllowedTools(config.extraTools);
  const permissionPromptTool = `mcp__${DEFAULT_PERMISSION_MCP_SERVER_NAME}__${DEFAULT_PERMISSION_TOOL_NAME}`;
  const mcpConfig = { mcpServers };
  const cliArgs = [
    "--allowedTools",
    allowedTools.join(","),
    "--permission-prompt-tool",
    permissionPromptTool,
    "--mcp-config",
    JSON.stringify(mcpConfig),
  ];

  return {
    allowedTools,
    cliArgs,
    cwd: params?.cwd ?? config.cwd,
    mcpConfig,
    permissionPromptTool,
    timeoutMs: 300_000,
  };
}

export const CLAUDE_CODE_DEFAULT_ALLOWED_TOOLS = DEFAULT_ALLOWED_TOOLS;
export const CLAUDE_CODE_DEFAULT_MCP_SERVER_NAME = DEFAULT_PERMISSION_MCP_SERVER_NAME;
export const CLAUDE_CODE_DEFAULT_PERMISSION_TOOL_NAME = DEFAULT_PERMISSION_TOOL_NAME;
