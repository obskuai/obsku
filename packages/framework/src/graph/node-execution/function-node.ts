import { completeNodeExecution, type NodeExecutionOutcome } from "./types";

export async function executeFunctionNode(
  executor: (input: unknown) => Promise<unknown>,
  input: string
): Promise<NodeExecutionOutcome> {
  return completeNodeExecution(await executor(input));
}
