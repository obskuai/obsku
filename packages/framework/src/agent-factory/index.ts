// =============================================================================
// @obsku/framework — Agent Factory: Public entry point
// =============================================================================
// Barrel that re-exports all public symbols from the decomposed modules.
// External consumers import from this file; no import paths need to change.
//
// Decomposition:
//   depth.ts    — depth protection (AsyncLocalStorage utilities)
//   registry.ts — AgentFactoryRegistry class (registry + validation + execution)
//   tools.ts    — tool factory functions (create_agent, call_agent, execute_agent)

export { AgentFactoryRegistry } from "./registry";
export {
  createCallAgentTool,
  createCreateAgentTool,
  createExecuteAgentTool,
} from "./tools";
