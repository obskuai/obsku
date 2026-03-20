import { Effect } from "effect";
import { agent } from "../agent";
import type { MemoryProvider } from "../memory/types";
import { BlockType, MessageRole } from "../types/constants";
import type { AgentEvent, Message, PluginDef } from "../types";
import { z } from "zod";
import type { HandoffContext, HandoffTarget } from "./types";

export type EmitFn = (event: AgentEvent) => Effect.Effect<boolean>;

export interface HandoffResult {
  handoff: true;
  result: string;
  targetAgent: string;
}

class HandoffMemoryProvider implements MemoryProvider {
  constructor(private messages: Array<Message>) {}

  async load(): Promise<Array<Message>> {
    return this.messages;
  }

  async save(): Promise<void> {
    return undefined;
  }
}

const HandoffSchema = z.object({});

export function createHandoffToolDef(target: HandoffTarget): PluginDef<typeof HandoffSchema> {
  return {
    description: target.description,
    name: `transfer_to_${target.agent.name}`,
    params: HandoffSchema,
    run: async (_input, _ctx) => {
      throw new Error(
        "Handoff tool run() should not be called directly. Use executeHandoff instead."
      );
    },
  };
}

export async function executeHandoff(
  target: HandoffTarget,
  ctx: HandoffContext,
  emit: EmitFn,
  fromAgentName: string
): Promise<HandoffResult> {
  await Effect.runPromise(
    emit({
      fromAgent: fromAgentName,
      timestamp: Date.now(),
      toAgent: target.agent.name,
      type: "handoff.start",
    })
  );

  const lastUserMessage = ctx.messages
    .slice()
    .reverse()
    .find((m) => m.role === MessageRole.USER);
  const input =
    lastUserMessage?.content[0]?.type === BlockType.TEXT ? lastUserMessage.content[0].text : "";

  const handoffMemory = new HandoffMemoryProvider(ctx.messages);
  const targetAgentWithMemory = agent({
    ...target.agent,
    memory: handoffMemory,
  });

  const result = await targetAgentWithMemory.run(input, ctx.provider, {
    sessionId: "handoff-session",
  });

  await Effect.runPromise(
    emit({
      agent: target.agent.name,
      result,
      timestamp: Date.now(),
      type: "handoff.complete",
    })
  );

  return { handoff: true, result, targetAgent: target.agent.name };
}

export function isHandoffToolName(name: string): boolean {
  return name.startsWith("transfer_to_");
}

export function getHandoffTargetByName(
  name: string,
  handoffs: Array<HandoffTarget>
): HandoffTarget | undefined {
  const agentName = name.replace("transfer_to_", "");
  return handoffs.find((h) => h.agent.name === agentName);
}
