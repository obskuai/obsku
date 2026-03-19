import type { ExecutionResult, SupportedLanguage } from "@obsku/tool-code-interpreter";
import type { WasmContext, WasmRuntime, WasmRuntimeOptions } from "./types";

export interface WasmContextState {
  id: string;
  workspace: {
    cleanup: () => Promise<void>;
    collectOutputFiles: (exclude: Array<string>) => Promise<Map<string, Uint8Array>>;
    stageFile: (name: string, content: string | Uint8Array) => Promise<unknown>;
  };
}

interface WasmContextEntry<TState extends WasmContextState> {
  activeOperations: number;
  destroying: boolean;
  idleResolvers: Array<() => void>;
  state: TState;
}

/**
 * Base class for WASM runtimes. Manages a map of named execution contexts and
 * provides the shared lifecycle contract:
 *
 *   initialize()       — one-time runtime setup; overridden by QuickJS to load
 *                         its WASM module.
 *   createContext(id)  — lazy-create a named context (calls createRuntimeState).
 *   execute(code)      — stateless execution via the shared "__default__" context.
 *   destroyContext(id) — release WASM memory + workspace for one context.
 *   dispose()          — destroy all contexts and shut down the runtime.
 *
 * Subclasses implement:
 *   createRuntimeState  — allocate runtime-specific state for a new context.
 *   destroyRuntimeState — release runtime-specific state.
 *   executeInContext    — runtime-specific code evaluation.
 */
export abstract class AbstractWasmRuntime<TState extends WasmContextState> implements WasmRuntime {
  abstract name: string;
  abstract supportedLanguages: Array<SupportedLanguage>;

  private contexts = new Map<string, WasmContextEntry<TState>>();
  private disposed = false;

  protected abstract createRuntimeState(id: string): Promise<TState>;
  protected abstract destroyRuntimeState(state: TState): Promise<void>;
  protected abstract executeInContext(
    state: TState,
    code: string,
    options: WasmRuntimeOptions
  ): Promise<ExecutionResult>;

  /** One-time runtime setup. QuickJS overrides this to load its WASM module. */
  async initialize(): Promise<void> {
    return;
  }

  /** Stateless execution using the shared "__default__" context. */
  async execute(code: string, options: WasmRuntimeOptions = {}): Promise<ExecutionResult> {
    const entry = await this.getOrCreateEntry("__default__");
    return this.withActiveContextEntry(entry, (state) =>
      this.executeInContext(state, code, options)
    );
  }

  /** Create or retrieve a named execution context. Lazy: calls createRuntimeState
   *  only on the first request for a given id. */
  async createContext(id: string): Promise<WasmContext> {
    if (this.disposed) {
      throw new Error(`${this.name} runtime disposed`);
    }
    await this.getOrCreateEntry(id);
    return this.buildContextHandle(id);
  }

  /** Destroy a named context, releasing its WASM memory and workspace. */
  async destroyContext(id: string): Promise<void> {
    const entry = this.contexts.get(id);
    if (!entry) {
      return;
    }
    entry.destroying = true;
    await this.waitForIdle(entry);
    await this.destroyRuntimeState(entry.state);
    this.contexts.delete(id);
  }

  /** Destroy all contexts then mark the runtime as disposed. */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const id of Array.from(this.contexts.keys())) {
      await this.destroyContext(id);
    }
    this.contexts.clear();
  }

  /** Build the public WasmContext handle from internal runtime state. */
  protected buildContextHandle(id: string): WasmContext {
    return {
      execute: async (code: string) => {
        const entry = this.getActiveEntry(id);
        return this.withActiveContextEntry(entry, (state) =>
          this.executeInContext(state, code, {})
        );
      },
      id,
      listFiles: async () => {
        const entry = this.getActiveEntry(id);
        const outputs = await this.withActiveContextEntry(entry, (state) =>
          state.workspace.collectOutputFiles([])
        );
        return Array.from(outputs.keys());
      },
      mountFile: async (name: string, content: string | Uint8Array) => {
        const entry = this.getActiveEntry(id);
        await this.withActiveContextEntry(entry, (state) =>
          state.workspace.stageFile(name, content)
        );
      },
      readFile: async (name: string) => {
        const entry = this.getActiveEntry(id);
        const outputs = await this.withActiveContextEntry(entry, (state) =>
          state.workspace.collectOutputFiles([])
        );
        const data = outputs.get(name);
        if (!data) {
          throw new Error(`File not found: ${name}`);
        }
        return data;
      },
    };
  }

  /** Lazily create runtime state for id, or return the existing state. */
  private async getOrCreateEntry(id: string): Promise<WasmContextEntry<TState>> {
    if (this.disposed) {
      throw new Error(`${this.name} runtime disposed`);
    }
    let entry = this.contexts.get(id);
    if (!entry) {
      const state = await this.createRuntimeState(id);
      entry = {
        activeOperations: 0,
        destroying: false,
        idleResolvers: [],
        state,
      };
      this.contexts.set(id, entry);
    }
    return entry;
  }

  private getActiveEntry(id: string): WasmContextEntry<TState> {
    const entry = this.contexts.get(id);
    if (!entry || entry.destroying) {
      throw new Error(`Context not available: ${id}`);
    }
    return entry;
  }

  private async withActiveContextEntry<TResult>(
    entry: WasmContextEntry<TState>,
    operation: (state: TState) => Promise<TResult>
  ): Promise<TResult> {
    if (entry.destroying) {
      throw new Error(`Context not available: ${entry.state.id}`);
    }
    entry.activeOperations += 1;
    try {
      return await operation(entry.state);
    } finally {
      entry.activeOperations -= 1;
      if (entry.activeOperations === 0) {
        for (const resolve of entry.idleResolvers.splice(0)) {
          resolve();
        }
      }
    }
  }

  private async waitForIdle(entry: WasmContextEntry<TState>): Promise<void> {
    if (entry.activeOperations === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      entry.idleResolvers.push(resolve);
    });
  }
}
