import type { PluginDef } from "../types";

export interface McpServerConfig {
  args?: Array<string>;
  command: string;
  env?: Record<string, string>;
  transport?: "stdio" | "streamable-http";
  url?: string;
}

export interface McpHostServerConfig {
  name: string;
  port?: number;
  tools: Array<PluginDef>;
  transport?: "stdio" | "streamable-http";
  version: string;
}
