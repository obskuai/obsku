import { CheckpointNotFoundError, SessionNotFoundError } from "../errors";
import type { CheckpointBackend, Session } from "../types";

export async function forkFromCheckpoint(
  store: CheckpointBackend,
  checkpointId: string,
  options: { title?: string } = {}
): Promise<Session> {
  const cp = await store.getCheckpoint(checkpointId);
  if (!cp) {
    throw new CheckpointNotFoundError(checkpointId);
  }

  const orig = await store.getSession(cp.sessionId);
  if (!orig) {
    throw new SessionNotFoundError(cp.sessionId);
  }

  const newSession = await store.createSession(orig.directory, {
    metadata: orig.metadata,
    title: options.title ?? `Fork of ${orig.title ?? checkpointId}`,
    workspaceId: orig.workspaceId,
  });

  const msgs = await store.getMessages(cp.sessionId, { before: cp.createdAt + 1 });
  for (const msg of msgs) {
    await store.addMessage(newSession.id, {
      content: msg.content,
      role: msg.role,
      sessionId: newSession.id,
      tokensIn: msg.tokensIn,
      tokensOut: msg.tokensOut,
      toolCalls: msg.toolCalls,
      toolResults: msg.toolResults,
    });
  }

  await store.saveCheckpoint({
    cycleState: cp.cycleState,
    namespace: cp.namespace,
    nodeId: cp.nodeId,
    nodeResults: cp.nodeResults,
    parentId: checkpointId,
    pendingNodes: cp.pendingNodes,
    sessionId: newSession.id,
    source: "fork",
    step: cp.step,
    version: cp.version,
  });

  return newSession;
}
