export interface ClaudeCodeMcpServerConfig {
  readonly args?: ReadonlyArray<string>;
  readonly command: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly transport?: "stdio" | "streamable-http";
  readonly type?: "stdio" | "streamable-http";
  readonly url?: string;
}

export interface ClaudeCodePluginConfig {
  readonly cwd?: string;
  readonly extraMcpServers?: Readonly<Record<string, ClaudeCodeMcpServerConfig>>;
  readonly extraTools?: ReadonlyArray<string>;
}

export type ClaudeCodeMode = "json" | "text";

export type ClaudeCodeSchemaObject = Record<string, unknown>;

export interface ClaudeCodePluginParams {
  readonly cwd?: string;
  readonly mode?: ClaudeCodeMode;
  readonly prompt: string;
  readonly schema?: ClaudeCodeSchemaObject;
}
