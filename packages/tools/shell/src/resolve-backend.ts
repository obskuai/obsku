/**
 * Shell backend auto-discovery module
 *
 * Resolves which shell backend to use (local or sandboxed) based on
 * explicit configuration and package availability.
 */

export type ShellBackend = "local" | "sandbox";

interface ResolveBackendDeps {
  loadSandboxModule?: () => Promise<SandboxModule>;
}

/**
 * Resolve which shell backend to use
 *
 * @param explicit - If provided, use this backend (throws if package not installed)
 * @returns The resolved backend ("local" or "sandbox")
 */
export async function resolveShellBackend(
  explicit?: ShellBackend,
  deps?: ResolveBackendDeps
): Promise<ShellBackend> {
  const loadSandboxModule = deps?.loadSandboxModule ?? loadSandboxExecutor;

  if (explicit !== undefined) {
    if (explicit === "local") {
      console.debug("[obsku:shell] backend: %s", "local");
      return "local";
    }
    // explicit === "sandbox" — verify it's installed
    try {
      await loadSandboxModule();
      console.debug("[obsku:shell] backend: %s", "sandbox");
      return "sandbox";
    } catch {
      throw new Error("@obsku/tool-shell-sandbox is not installed");
    }
  }

  // Auto-discovery: try sandbox first, fallback to local
  try {
    await loadSandboxModule();
    console.debug("[obsku:shell] backend: %s", "sandbox");
    return "sandbox";
  } catch {
    console.debug("[obsku:shell] backend: %s", "local");
    return "local";
  }
}

/**
 * Type representing the sandbox module exports
 * Matches @obsku/tool-shell-sandbox package structure
 */
export interface SandboxModule {
  SandboxedShellExecutor: {
    new (options: {
      fs: "memory" | "overlay";
      network?: {
        enabled: boolean;
        allowedUrlPrefixes?: string[];
      };
      timeout?: number;
      envFilter?: {
        mode: "blocklist" | "allowlist" | "none";
        patterns?: string[];
        warn?: boolean;
      };
    }): {
      execute(opts: {
        command: string;
        args?: string[];
        cwd?: string;
        timeout?: number;
        env?: Record<string, string>;
      }): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
        timedOut: boolean;
      }>;
      dispose(): Promise<void>;
    };
    prototype: {
      execute(opts: {
        command: string;
        args?: string[];
        cwd?: string;
        timeout?: number;
        env?: Record<string, string>;
      }): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
        timedOut: boolean;
      }>;
      dispose(): Promise<void>;
    };
  };
  createSandboxedExec: (options?: {
    fs?: "memory" | "overlay";
    network?: {
      enabled: boolean;
      allowedUrlPrefixes?: string[];
    };
    timeout?: number;
    envFilter?: {
      mode: "blocklist" | "allowlist" | "none";
      patterns?: string[];
      warn?: boolean;
    };
  }) => unknown;
  sandboxedExec: unknown;
}

/**
 * Load the sandbox executor module
 *
 * @returns The sandbox module exports
 * @throws Error if @obsku/tool-shell-sandbox is not installed
 */
export async function loadSandboxExecutor(deps?: ResolveBackendDeps): Promise<SandboxModule> {
  if (deps?.loadSandboxModule) {
    return deps.loadSandboxModule();
  }

  try {
    // @ts-expect-error - optional peer dependency, may not be installed
    return await import("@obsku/tool-shell-sandbox");
  } catch {
    throw new Error("@obsku/tool-shell-sandbox is not installed");
  }
}
