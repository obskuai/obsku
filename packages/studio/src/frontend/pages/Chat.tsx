import {
  AssistantRuntimeProvider,
  type ChatModelAdapter,
  type ChatModelRunResult,
  ComposerPrimitive,
  MessagePrimitive,
  type ThreadMessage,
  ThreadPrimitive,
  useLocalRuntime,
} from "@assistant-ui/react";
import { Bot, MessageSquare, SendHorizonal } from "lucide-react";
import { type ChangeEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { ApiError, getAgent, listAgents, postChat } from "../lib/api";
import { cn } from "../lib/utils";

export const CHAT_AGENTS = [] as const;

export interface ParsedSseEvent {
  event: string;
  data: string;
}

function getLatestUserMessage(messages: readonly ThreadMessage[]): ThreadMessage | undefined {
  return [...messages].reverse().find((message) => message.role === "user");
}

export function getTextContent(message: ThreadMessage | undefined): string {
  if (!message) {
    return "";
  }

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function parseSseEventBlock(block: string): ParsedSseEvent | undefined {
  const lines = block.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}

export async function* streamChatResponse(
  response: Response,
  onSessionId?: (sessionId: string) => void
): AsyncGenerator<ChatModelRunResult, void> {
  if (!response.ok) {
    throw new Error(await response.text());
  }

  if (!response.body) {
    throw new Error("Chat response body is missing");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let latestText = "";

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

      const parsed = parseSseEventBlock(block);
      if (!parsed) {
        continue;
      }

      const payload = JSON.parse(parsed.data) as {
        message?: string;
        sessionId?: string;
        text?: string;
      };

      if (payload.sessionId) {
        onSessionId?.(payload.sessionId);
      }

      if (parsed.event === "error") {
        throw new Error(payload.message ?? "Chat stream failed");
      }

      if (typeof payload.text === "string" && payload.text !== latestText) {
        latestText = payload.text;
        yield {
          content: [{ type: "text", text: latestText }],
        };
      }

      if (parsed.event === "done") {
        return;
      }
    }
  }
}

export function createChatModelAdapter(options: {
  agentName: string;
  onSessionId?: (sessionId: string) => void;
  sessionId?: string;
}): ChatModelAdapter {
  return {
    async *run({ abortSignal, messages }) {
      const prompt = getTextContent(getLatestUserMessage(messages));
      if (!prompt) {
        return;
      }

      const response = await postChat(
        {
          message: prompt,
          agentName: options.agentName,
          sessionId: options.sessionId,
        },
        abortSignal
      );

      yield* streamChatResponse(response, options.onSessionId);
    },
  };
}

function ChatRuntime({
  agentName,
  onSessionId,
  sessionId,
}: {
  agentName: string;
  onSessionId: (sessionId: string) => void;
  sessionId?: string;
}) {
  const adapter = useMemo(
    () => createChatModelAdapter({ agentName, onSessionId, sessionId }),
    [agentName, onSessionId, sessionId]
  );
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatThread agentName={agentName} />
    </AssistantRuntimeProvider>
  );
}

function ChatThread({ agentName }: { agentName: string }) {
  return (
    <ThreadPrimitive.Root className="flex h-[640px] flex-col overflow-hidden rounded-2xl border bg-white shadow-sm">
      <ThreadPrimitive.Viewport className="flex-1 space-y-4 overflow-y-auto bg-slate-50/80 p-4 md:p-6">
        <ThreadPrimitive.Empty>
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 text-center text-slate-500">
            <div className="rounded-full border border-sky-200 bg-sky-100 p-4 text-sky-700">
              <Bot className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-900">Start a new thread</h2>
              <p className="max-w-md text-sm">
                Send a prompt to <span className="font-medium text-slate-900">{agentName}</span>.
              </p>
            </div>
          </div>
        </ThreadPrimitive.Empty>

        <ThreadPrimitive.Messages>
          {({ message }) => (
            <ChatBubble role={message.role}>
              <MessagePrimitive.Root
                className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-3 shadow-sm",
                    message.role === "user"
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-900"
                  )}
                >
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] opacity-70">
                    {message.role === "user" ? "You" : agentName}
                  </div>
                  <div className="text-sm leading-6">
                    <MessagePrimitive.Parts />
                  </div>
                </div>
              </MessagePrimitive.Root>
            </ChatBubble>
          )}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>

      <div className="border-t border-slate-200 bg-white p-4">
        <ComposerPrimitive.Root className="rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-inner">
          <ComposerPrimitive.Input
            rows={3}
            className="w-full resize-none border-0 bg-transparent text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"
            placeholder="Ask your agent for help..."
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Streaming response over SSE</p>
            <ComposerPrimitive.Send asChild>
              <button
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                type="submit"
              >
                Send
                <SendHorizonal className="h-4 w-4" />
              </button>
            </ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}

function ChatBubble({ children, role }: { children: ReactNode; role: ThreadMessage["role"] }) {
  return (
    <div className={cn("w-full", role === "user" ? "items-end" : "items-start")}>{children}</div>
  );
}

export default function Chat() {
  const [searchParams] = useSearchParams();
  const [agents, setAgents] = useState<Array<{ label: string; value: string }>>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>(searchParams.get("agent") ?? "");
  const [runtimeModel, setRuntimeModel] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [agentError, setAgentError] = useState<string | null>(null);

  const handleAgentChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedAgent((event.target as unknown as { value: string }).value);
  };

  useEffect(() => {
    let isMounted = true;

    async function loadAgents() {
      setIsLoadingAgents(true);
      setAgentError(null);

      try {
        const response = await listAgents();
        if (!isMounted) {
          return;
        }

        const nextAgents = response.agents.map((agent) => ({
          label: agent.name,
          value: agent.name,
        }));

        setAgents(nextAgents);
        setSelectedAgent((current) => {
          if (current && nextAgents.some((agent) => agent.value === current)) {
            return current;
          }

          return nextAgents[0]?.value ?? "";
        });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setAgentError(
          error instanceof ApiError ? error.message : "Could not load agents for chat."
        );
      } finally {
        if (isMounted) {
          setIsLoadingAgents(false);
        }
      }
    }

    void loadAgents();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    setSessionId(undefined);
  }, [selectedAgent]);

  useEffect(() => {
    if (!selectedAgent) {
      setRuntimeModel(null);
      return;
    }

    let isMounted = true;

    async function loadAgentDetail() {
      try {
        const response = await getAgent(selectedAgent);
        if (isMounted) {
          setRuntimeModel(response.agent.runtimeModel ?? null);
        }
      } catch {
        if (isMounted) {
          setRuntimeModel(null);
        }
      }
    }

    void loadAgentDetail();

    return () => {
      isMounted = false;
    };
  }, [selectedAgent]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chat</h1>
          <p className="text-muted-foreground">Stream agent answers through the studio chat API.</p>
        </div>

        <Card className="w-full max-w-sm border-slate-200 bg-white/90 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4 text-sky-600" />
              Agent runtime
            </CardTitle>
            <CardDescription>Choose which registered agent to talk to.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label
              className="block text-sm font-medium text-slate-700"
              htmlFor="chat-agent-selector"
            >
              Agent
            </label>
            <select
              id="chat-agent-selector"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500"
              value={selectedAgent}
              onChange={handleAgentChange}
              disabled={isLoadingAgents || agents.length === 0}
            >
              {agents.map((agent) => (
                <option key={agent.value} value={agent.value}>
                  {agent.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">
              {isLoadingAgents
                ? "Loading agents..."
                : (agentError ??
                  `${agents.length} agent${agents.length === 1 ? "" : "s"} available`)}
            </p>
            <p className="text-xs text-slate-500">
              Session: {sessionId ? sessionId : "new session"}
            </p>
            <p className="text-xs text-slate-500">Model: {runtimeModel ?? "Not exposed"}</p>
          </CardContent>
        </Card>
      </div>

      {selectedAgent ? (
        <ChatRuntime agentName={selectedAgent} onSessionId={setSessionId} sessionId={sessionId} />
      ) : (
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardContent className="py-12 text-center text-muted-foreground">
            {agentError ?? "No chat agents available yet."}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
