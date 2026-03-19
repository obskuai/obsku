/**
 * Core types for the sandboxed shell tool
 *
 * Provides type definitions for sandboxed shell execution using just-bash
 * with configurable filesystem strategies and network controls.
 */

/**
 * Configuration options for the sandboxed shell environment
 */
export interface SandboxedShellOptions {
  /**
   * Filesystem strategy:
   * - 'memory': Uses InMemoryFs (default) - fully isolated, no persistence
   * - 'overlay': Uses OverlayFs - overlays on host filesystem with copy-on-write
   */
  fs: "memory" | "overlay";

  /**
   * Network configuration (default: disabled)
   */
  network?: {
    /** Whether network access is enabled */
    enabled: boolean;
    /** Optional list of URL prefixes to allow (e.g., ['https://api.example.com/']) */
    allowedUrlPrefixes?: string[];
  };

  /**
   * Default timeout in milliseconds for shell commands
   * @default 30000
   */
  timeoutMs?: number;

  /**
   * Environment variable filtering configuration
   * @default { mode: 'blocklist', warn: true }
   */
  envFilter?: {
    /** Filter mode: 'blocklist' removes matching vars, 'allowlist' keeps only matching, 'none' disables filtering */
    mode: "blocklist" | "allowlist" | "none";
    /** Patterns to match (glob-style, case-insensitive) */
    patterns?: string[];
    /** Log warning when variables are filtered (default: true) */
    warn?: boolean;
  };
}

/**
 * Options for executing a shell command
 */
export interface ShellExecutionOptions {
  /** The shell command to execute */
  command: string;

  /**
   * Optional timeout override in milliseconds
   * If not provided, uses the executor's default timeout
   */
  timeoutMs?: number;

  /**
   * Optional environment variables to set for this execution
   * These are merged with (and override) the base environment
   */
  env?: Record<string, string>;

  /**
   * Optional arguments to append to the command
   * Each argument is shell-escaped to prevent injection
   */
  args?: string[];

  /**
   * Optional working directory for the command
   * For InMemoryFs, this is emulated via 'cd <cwd> && command'
   */
  cwd?: string;
}

/**
 * Result of a shell command execution
 *
 * Note: This matches the existing shell tool return shape exactly for
 * compatibility with existing code that consumes shell execution results.
 */
export interface ShellExecutionResult {
  /** Standard output from the command */
  stdout: string;
  /** Standard error from the command */
  stderr: string;
  /** Exit code from the command (0 typically means success) */
  exitCode: number;
  /** Whether the command timed out */
  timedOut: boolean;
}

/**
 * Interface for sandboxed shell executors
 *
 * Implementations provide sandboxed shell execution using just-bash
 * with configurable filesystem and network isolation.
 *
 * Note on `timedOut` field: just-bash doesn't return a `timedOut` field
 * directly. The adapter layer will need to detect timeout conditions
 * (e.g., by catching timeout errors) and map them to this field.
 */
export interface SandboxedShellExecutor {
  /**
   * Execute a shell command with sandboxing
   * @param opts - Execution options
   * @returns Promise resolving to the execution result
   */
  execute(opts: ShellExecutionOptions): Promise<ShellExecutionResult>;

  /**
   * Dispose of the executor and clean up resources
   * This should be called when the executor is no longer needed
   */
  dispose(): Promise<void>;
}
