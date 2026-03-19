import { createTaggedError } from "../errors/tagged-error";

export const MultiAgentConfigError = createTaggedError("MultiAgentConfigError");
export type MultiAgentConfigError = InstanceType<typeof MultiAgentConfigError>;
