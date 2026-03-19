export function sessionKey(prefix: string, id: string): string {
  return `${prefix}session:${id}`;
}

export function messagesKey(prefix: string, sessionId: string): string {
  return `${prefix}messages:${sessionId}`;
}

export function messageCounterKey(prefix: string, sessionId: string): string {
  return `${prefix}message:counter:${sessionId}`;
}

export function checkpointKey(prefix: string, id: string): string {
  return `${prefix}checkpoint:${id}`;
}

export function checkpointsIndexKey(prefix: string, sessionId: string, namespace: string): string {
  return `${prefix}checkpoints:${sessionId}:${namespace}`;
}

export function versionsIndexKey(prefix: string, sessionId: string, namespace: string): string {
  return `${prefix}versions:${sessionId}:${namespace}`;
}

export function entityKey(prefix: string, id: string): string {
  return `${prefix}entity:${id}`;
}

export function entitiesBySessionKey(prefix: string, sessionId: string): string {
  return `${prefix}entities:session:${sessionId}`;
}

export function entitiesByWorkspaceKey(prefix: string, workspaceId: string): string {
  return `${prefix}entities:workspace:${workspaceId}`;
}

export function entitiesByTypeKey(prefix: string, type: string): string {
  return `${prefix}entities:type:${type}`;
}

export function factKey(prefix: string, id: string): string {
  return `${prefix}fact:${id}`;
}

export function factsByWorkspaceKey(prefix: string, workspaceId: string): string {
  return `${prefix}facts:workspace:${workspaceId}`;
}
