/**
 * Code Interpreter Backend Auto-Discovery
 *
 * Resolves the appropriate executor based on available backends:
 * Priority: agentcore > wasm > local
 */

import { LocalProcessExecutor } from "./local-executor";
import { SessionManager } from "./session-manager";
import type { CodeExecutor } from "./types";

export type CodeInterpreterBackend = "local" | "wasm" | "agentcore";

export interface ResolvedCodeExecutor {
  backend: CodeInterpreterBackend;
  executor: CodeExecutor;
  sessionManager: SessionManager;
}

// Local interfaces for optional peer dependencies (packages may not be installed)
interface AgentCoreModule {
  AgentCoreExecutor: new (opts: {
    region: string;
    client?: unknown;
    codeInterpreterIdentifier?: string;
    credentials?: unknown;
    s3Upload?: unknown;
  }) => CodeExecutor;
  AgentCoreSessionManager: new (
    region: string,
    codeInterpreterIdentifier: string,
    client?: unknown
  ) => SessionManager;
  BedrockAgentCoreClient: new (opts: { region: string }) => unknown;
}

interface WasmModule {
  WasmExecutor: new () => CodeExecutor;
}

interface ResolveExecutorDeps {
  loadAgentcoreModule?: () => Promise<AgentCoreModule>;
  loadWasmModule?: () => Promise<WasmModule>;
  getRegion?: () => string | undefined;
}

const loadAgentcoreModule = async (): Promise<AgentCoreModule> => {
  const agentcoreId = "@obsku/tool-code-interpreter-agentcore";
  const awsSdkId = "@aws-sdk/client-bedrock-agentcore";
  const mod = (await import(agentcoreId)) as Record<string, unknown>;
  const awsSdk = (await import(awsSdkId)) as Record<string, unknown>;
  return {
    ...mod,
    BedrockAgentCoreClient: awsSdk.BedrockAgentCoreClient,
  } as unknown as AgentCoreModule;
};

const loadWasmModule = async (): Promise<WasmModule> => {
  const wasmModule = "@obsku/tool-code-interpreter-wasm";
  return import(wasmModule) as Promise<WasmModule>;
};

const getRegion = () => process.env.AWS_REGION;

/**
 * Resolve code executor with explicit backend selection.
 * Throws if the requested backend is not installed.
 */
async function resolveExplicit(
  backend: CodeInterpreterBackend,
  agentcoreOpts?: { region?: string },
  deps?: ResolveExecutorDeps
): Promise<ResolvedCodeExecutor> {
  const resolvedDeps = {
    loadAgentcoreModule: deps?.loadAgentcoreModule ?? loadAgentcoreModule,
    loadWasmModule: deps?.loadWasmModule ?? loadWasmModule,
    getRegion: deps?.getRegion ?? getRegion,
  };

  switch (backend) {
    case "agentcore": {
      const region = agentcoreOpts?.region ?? resolvedDeps.getRegion();
      if (!region) {
        throw new Error(
          "@obsku/tool-code-interpreter-agentcore requires region (set AWS_REGION or pass agentcoreOpts.region)"
        );
      }
      const mod = await resolvedDeps.loadAgentcoreModule();
      const client = new mod.BedrockAgentCoreClient({ region });
      const codeInterpreterIdentifier = "aws.codeinterpreter.v1";
      const executor = new mod.AgentCoreExecutor({
        region,
        client,
        codeInterpreterIdentifier,
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const sessionManager = new mod.AgentCoreSessionManager(
        region,
        codeInterpreterIdentifier,
        client
      );
      return { backend, executor, sessionManager };
    }
    case "wasm": {
      const mod = await resolvedDeps.loadWasmModule();
      const executor = new mod.WasmExecutor();
      const sessionManager = new SessionManager();
      return { backend, executor, sessionManager };
    }
    case "local": {
      const executor = new LocalProcessExecutor();
      const sessionManager = new SessionManager();
      return { backend, executor, sessionManager };
    }
    default: {
      throw new Error(`Unknown backend: ${backend}`);
    }
  }
}

/**
 * Auto-discover the best available backend.
 * Priority: agentcore > wasm > local
 */
async function resolveAuto(
  agentcoreOpts?: { region?: string },
  deps?: ResolveExecutorDeps
): Promise<ResolvedCodeExecutor> {
  const resolvedDeps = {
    loadAgentcoreModule: deps?.loadAgentcoreModule ?? loadAgentcoreModule,
    loadWasmModule: deps?.loadWasmModule ?? loadWasmModule,
    getRegion: deps?.getRegion ?? getRegion,
  };

  // 1. Try agentcore
  try {
    await resolvedDeps.loadAgentcoreModule();
    const region = agentcoreOpts?.region ?? resolvedDeps.getRegion();
    if (!region) {
    } else {
      return resolveExplicit("agentcore", agentcoreOpts, resolvedDeps);
    }
  } catch {
    // not installed, continue to wasm
  }

  // 2. Try wasm
  try {
    await resolvedDeps.loadWasmModule();
    return resolveExplicit("wasm", undefined, resolvedDeps);
  } catch {
    // not installed, fall back to local
  }

  // 3. Local fallback
  return resolveExplicit("local", undefined, resolvedDeps);
}

/**
 * Resolve the code executor backend.
 *
 * @param explicit - Force a specific backend. Throws if not installed.
 * @param agentcoreOpts - Options for agentcore backend (region override)
 * @returns Resolved executor, session manager, and backend name
 */
export async function resolveCodeExecutor(
  explicit?: CodeInterpreterBackend,
  agentcoreOpts?: { region?: string },
  deps?: ResolveExecutorDeps
): Promise<ResolvedCodeExecutor> {
  if (explicit !== undefined) {
    return resolveExplicit(explicit, agentcoreOpts, deps);
  }
  return resolveAuto(agentcoreOpts, deps);
}
