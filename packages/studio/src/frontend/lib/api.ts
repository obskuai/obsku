import { z } from "zod";

import {
  AgentDetailResponse,
  AgentListResponse,
  ChatRequest,
  EventDisplaySchema,
  GraphDetailResponse,
  GraphListResponse,
  ProvidersResponseSchema,
  SessionDetailResponse,
  SessionListResponse,
} from "../../shared/schemas";

const ServerErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, options: { status: number; code?: string; details?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}

async function readError(response: Response): Promise<ApiError> {
  const text = await response.text();

  if (!text) {
    return new ApiError(`Request failed with status ${response.status}`, {
      status: response.status,
    });
  }

  try {
    const parsed = ServerErrorSchema.parse(JSON.parse(text));
    return new ApiError(parsed.error, {
      status: response.status,
      code: parsed.code,
      details: parsed.details,
    });
  } catch {
    return new ApiError(text, { status: response.status });
  }
}

async function fetchJson<TSchema extends z.ZodTypeAny>(
  input: string,
  schema: TSchema,
  init?: RequestInit
): Promise<z.infer<TSchema>> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw await readError(response);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new ApiError("The server returned an invalid JSON response.", {
      status: response.status,
    });
  }

  try {
    return schema.parse(payload);
  } catch {
    throw new ApiError("The server returned an unexpected response shape.", {
      status: response.status,
      details: payload,
    });
  }
}

export async function listAgents() {
  return fetchJson("/api/agents", AgentListResponse);
}

export async function getAgent(name: string) {
  return fetchJson(`/api/agents/${encodeURIComponent(name)}`, AgentDetailResponse);
}

export async function listGraphs() {
  return fetchJson("/api/graphs", GraphListResponse);
}

export async function getGraph(id: string) {
  return fetchJson(`/api/graphs/${encodeURIComponent(id)}`, GraphDetailResponse);
}

export async function listProviders() {
  return fetchJson("/api/providers", ProvidersResponseSchema);
}

export async function listSessions(page = 1, limit = 20) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });

  return fetchJson(`/api/sessions?${params.toString()}`, SessionListResponse);
}

export async function getSession(id: string) {
  return fetchJson(`/api/sessions/${encodeURIComponent(id)}`, SessionDetailResponse);
}

export async function streamSessionEvents(
  sessionId: string,
  onEvent: (event: z.infer<typeof EventDisplaySchema>) => void,
  signal?: AbortSignal
) {
  const params = new URLSearchParams({ sessionId });
  const response = await fetch(`/api/events?${params.toString()}`, { signal });

  if (!response.ok) {
    throw await readError(response);
  }

  if (!response.body) {
    throw new ApiError("The event stream is unavailable.", { status: response.status });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) {
        break;
      }

      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const lines = block.split("\n");
      const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());

      if (dataLines.length === 0) {
        continue;
      }

      onEvent(EventDisplaySchema.parse(JSON.parse(dataLines.join("\n"))));
    }
  }
}

export async function postChat(request: z.input<typeof ChatRequest>, signal?: AbortSignal) {
  const payload = ChatRequest.parse(request);

  return fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });
}
