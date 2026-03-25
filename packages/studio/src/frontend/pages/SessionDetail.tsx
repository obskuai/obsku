import { format } from "date-fns";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Code,
  MessageSquare,
  Terminal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { ScrollArea } from "../components/ui/scroll-area";
import { Separator } from "../components/ui/separator";
import { ApiError, getSession, streamSessionEvents } from "../lib/api";

type SessionEventItem = Awaited<ReturnType<typeof getSession>>["events"][number] & { key: string };

function buildEventKey(
  event: Awaited<ReturnType<typeof getSession>>["events"][number],
  index: number
) {
  return `${event.timestamp}-${event.type}-${index}`;
}

function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") {
    return "default";
  }

  if (status === "failed") {
    return "destructive";
  }

  return "secondary";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "Session not found.";
    }

    return error.message;
  }

  return "Could not load session details.";
}

const EventIcon = ({ category }: { category: string }) => {
  switch (category) {
    case "session":
    case "stream":
      return <MessageSquare className="h-4 w-4" />;
    case "tool":
      return <Code className="h-4 w-4" />;
    case "error":
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    case "agent":
    case "background":
    case "graph":
    case "checkpoint":
    case "guardrail":
    case "handoff":
    case "supervisor":
    case "context":
    default:
      return <Terminal className="h-4 w-4" />;
  }
};

const EventBadge = ({ category, severity }: { category: string; severity: string }) => {
  if (severity === "error") {
    return <Badge variant="destructive">{category}</Badge>;
  }

  if (severity === "warning") {
    return <Badge variant="outline">{category}</Badge>;
  }

  if (severity === "success") {
    return <Badge variant="default">{category}</Badge>;
  }

  return <Badge variant="secondary">{category}</Badge>;
};

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Awaited<ReturnType<typeof getSession>>["session"] | null>(
    null
  );
  const [events, setEvents] = useState<SessionEventItem[]>([]);
  const [openEvents, setOpenEvents] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("Session not found.");
      setIsLoading(false);
      return;
    }

    const sessionId = id;
    const abortController = new AbortController();
    let isMounted = true;

    async function loadSession() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getSession(sessionId);
        if (!isMounted) {
          return;
        }

        setSession(response.session);
        setEvents(
          response.events.map((event, index) => ({ ...event, key: buildEventKey(event, index) }))
        );
        setIsLoading(false);

        void streamSessionEvents(
          sessionId,
          (event) => {
            if (!isMounted) {
              return;
            }

            setEvents((current) => {
              const nextEvent = { ...event, key: buildEventKey(event, current.length) };
              return [...current, nextEvent];
            });
          },
          abortController.signal
        ).catch((streamError) => {
          if (!isMounted || abortController.signal.aborted) {
            return;
          }

          setError(getErrorMessage(streamError));
        });
      } catch (loadError) {
        if (isMounted) {
          setSession(null);
          setEvents([]);
          setError(getErrorMessage(loadError));
          setIsLoading(false);
        }
      }
    }

    void loadSession();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [id]);

  const heading = useMemo(() => {
    if (session) {
      return `Session ${session.id}`;
    }

    return "Session detail";
  }, [session]);

  const toggleEvent = (eventKey: string) => {
    setOpenEvents((current) => ({ ...current, [eventKey]: !current[eventKey] }));
  };

  return (
    <div className="mx-auto flex h-screen max-w-6xl flex-col p-8">
      <div className="mb-6 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{heading}</h1>
          <p className="mt-1 text-muted-foreground">{session?.title ?? "Live session timeline"}</p>
        </div>
        <div className="flex gap-2">
          {session ? (
            <Badge variant={getStatusVariant(session.status)}>{session.status}</Badge>
          ) : null}
          {session?.runtimeModel ? <Badge variant="outline">{session.runtimeModel}</Badge> : null}
          <Badge variant="outline">{events.length} Events</Badge>
        </div>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="shrink-0">
          <CardTitle>Event Timeline</CardTitle>
          <CardDescription>Chronological sequence of session events</CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full p-6">
            {isLoading ? (
              <div className="py-12 text-center text-muted-foreground">
                Loading session timeline...
              </div>
            ) : error ? (
              <div className="space-y-4 py-12 text-center text-muted-foreground">
                <div>{error}</div>
                <div className="text-sm">If the session just started, refresh after a moment.</div>
              </div>
            ) : events.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">No events recorded yet.</div>
            ) : (
              <div className="space-y-4">
                {events.map((event) => (
                  <Card key={event.key} className="overflow-hidden">
                    <Collapsible
                      open={openEvents[event.key]}
                      onOpenChange={() => toggleEvent(event.key)}
                    >
                      <div className="flex items-center justify-between bg-muted/50 p-4">
                        <div className="flex items-center gap-4">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full border bg-background">
                            <EventIcon category={event.category} />
                          </div>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <EventBadge category={event.category} severity={event.severity} />
                              <span className="font-mono text-xs text-muted-foreground">
                                {event.type}
                              </span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {format(new Date(event.timestamp), "HH:mm:ss.SSS")}
                              </span>
                            </div>
                            {event.agent ? (
                              <span className="text-xs text-muted-foreground">
                                Agent: {event.agent}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="w-9 p-0">
                            {openEvents[event.key] ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                            <span className="sr-only">Toggle</span>
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                      <CollapsibleContent>
                        <Separator />
                        <div className="bg-muted/20 p-4">
                          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">
                            {JSON.stringify(event.data, null, 2)}
                          </pre>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
