import type { LLMProvider } from "@obsku/framework";
import { type A2ARequest, type A2AResponse, type AgentCard, serveA2A } from "./a2a-handler";
import { type AgentCoreRequest, serveAgentCore } from "./agentcore-handler";
import { DEFAULT_PORT } from "./constants";
import { type AgentLike, type ServeOptions } from "./shared";

export type { AgentCard, A2ARequest, A2AResponse, AgentCoreRequest, AgentLike, ServeOptions };
export type { StrandsPublicPayload } from "./strands-policy";
export { createStrandsPolicy, strandsPolicy } from "./strands-policy";

export function serve(
  a: AgentLike,
  provider: LLMProvider,
  opts?: ServeOptions
): ReturnType<typeof Bun.serve> {
  const protocol = opts?.protocol ?? "a2a";
  const defaultPort = protocol === "agentcore" ? DEFAULT_PORT.agentCore : DEFAULT_PORT.a2a;
  const port = opts?.port ?? Number(process.env.PORT || defaultPort);

  if (protocol === "agentcore") {
    return serveAgentCore(a, provider, opts, port);
  }
  return serveA2A(a, provider, opts, port);
}
