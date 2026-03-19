import { createTaggedError } from "../errors/tagged-error";

export class McpSdkLoadError extends createTaggedError("McpSdkLoadError") {
  constructor(message: string) {
    super(`Failed to load MCP SDK: ${message}`);
  }
}

export const McpConfigError = createTaggedError("McpConfigError");
export type McpConfigError = InstanceType<typeof McpConfigError>;
