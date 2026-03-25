import {
  ArrowLeft,
  Bot,
  BrainCircuit,
  GitMerge,
  MessageSquare,
  Shield,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Separator } from "../components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ApiError, getAgent } from "../lib/api";

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "Agent not found.";
    }

    return error.message;
  }

  return "Could not load agent details.";
}

export default function AgentDetail() {
  const { name } = useParams<{ name: string }>();
  const [agent, setAgent] = useState<Awaited<ReturnType<typeof getAgent>>["agent"] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) {
      setError("Agent not found.");
      setIsLoading(false);
      return;
    }

    const agentName = name;
    let isMounted = true;

    async function loadAgent() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getAgent(agentName);
        if (isMounted) {
          setAgent(response.agent);
        }
      } catch (loadError) {
        if (isMounted) {
          setAgent(null);
          setError(getErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadAgent();

    return () => {
      isMounted = false;
    };
  }, [name]);

  return (
    <div className="container mx-auto max-w-5xl space-y-6 py-8">
      <Button variant="ghost" asChild className="mb-2">
        <Link to="/agents">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Agents
        </Link>
      </Button>

      {isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Loading agent details...
          </CardContent>
        </Card>
      ) : error || !agent ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {error ?? "Agent not found."}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <div>
              <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
                <Bot className="h-8 w-8 text-primary" />
                {agent.name}
              </h1>
              <p className="mt-1 text-muted-foreground">
                Agent definition and configuration details.
              </p>
            </div>
            <Button size="lg" asChild>
              <Link to={`/chat?agent=${encodeURIComponent(agent.name)}`}>
                <MessageSquare className="mr-2 h-5 w-5" />
                Chat with this agent
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="space-y-6 md:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Prompt</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md bg-muted p-4 font-mono text-sm whitespace-pre-wrap">
                    {agent.promptPreview}
                  </div>
                </CardContent>
              </Card>

              <Tabs defaultValue="tools" className="w-full">
                <TabsList className="h-auto w-full justify-start rounded-none border-b bg-transparent p-0">
                  <TabsTrigger
                    value="tools"
                    className="rounded-none px-4 py-2 data-[state=active]:border-b-2 data-[state=active]:border-primary"
                  >
                    Tools ({agent.tools.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="handoffs"
                    className="rounded-none px-4 py-2 data-[state=active]:border-b-2 data-[state=active]:border-primary"
                  >
                    Handoffs ({agent.handoffsCount})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="tools" className="pt-4">
                  <Card>
                    <CardContent className="pt-6">
                      {agent.tools.length > 0 ? (
                        <div className="space-y-4">
                          {agent.tools.map((tool) => (
                            <div
                              key={tool.name}
                              className="flex items-center justify-between gap-3"
                            >
                              <div className="flex items-center gap-2">
                                <Wrench className="h-4 w-4 text-muted-foreground" />
                                <div>
                                  <div className="font-medium">{tool.name}</div>
                                  <div className="text-sm text-muted-foreground">
                                    {tool.description ?? "No description provided."}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No tools configured.</p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="handoffs" className="pt-4">
                  <Card>
                    <CardContent className="space-y-3 pt-6">
                      <div className="flex items-center gap-2">
                        <GitMerge className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">
                          {agent.handoffsCount} handoff targets configured
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        This API currently exposes the total handoff count, not individual targets.
                      </p>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <BrainCircuit className="h-5 w-5" />
                    Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-1 text-sm font-medium text-muted-foreground">
                      Runtime Model
                    </div>
                    <div>{agent.runtimeModel ?? "Not exposed"}</div>
                  </div>
                  <Separator />
                  <div>
                    <div className="mb-1 text-sm font-medium text-muted-foreground">
                      Max Iterations
                    </div>
                    <div>{agent.maxIterations}</div>
                  </div>
                  <Separator />
                  <div>
                    <div className="mb-1 text-sm font-medium text-muted-foreground">Memory</div>
                    {agent.memory ? (
                      <div className="space-y-2">
                        <Badge variant="outline" className="capitalize">
                          {agent.memory.type}
                        </Badge>
                        {typeof agent.memory.maxMessages === "number" ? (
                          <div className="text-sm text-muted-foreground">
                            Max messages: {agent.memory.maxMessages}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-sm">No custom memory configured</span>
                    )}
                  </div>
                  <Separator />
                  <div>
                    <div className="mb-1 text-sm font-medium text-muted-foreground">Streaming</div>
                    <Badge variant={agent.streaming ? "default" : "secondary"}>
                      {agent.streaming ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                  <Separator />
                  <div>
                    <div className="mb-1 text-sm font-medium text-muted-foreground">
                      Tool timeout
                    </div>
                    <div>{agent.toolTimeout} ms</div>
                  </div>
                  <Separator />
                  <div>
                    <div className="mb-1 text-sm font-medium text-muted-foreground">
                      Tool concurrency
                    </div>
                    <div>{agent.toolConcurrency}</div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Shield className="h-5 w-5" />
                    Guardrails
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-1 text-sm font-medium text-muted-foreground">
                      Input Guardrails
                    </div>
                    <div className="font-medium">{agent.guardrailsCount.input} configured</div>
                  </div>
                  <Separator />
                  <div>
                    <div className="mb-1 text-sm font-medium text-muted-foreground">
                      Output Guardrails
                    </div>
                    <div className="font-medium">{agent.guardrailsCount.output} configured</div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
