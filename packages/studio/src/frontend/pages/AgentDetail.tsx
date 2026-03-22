import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Bot, MessageSquare, Shield, BrainCircuit, Wrench, GitMerge } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

import { MOCK_AGENTS } from "./AgentList";

export default function AgentDetail() {
  const { name } = useParams<{ name: string }>();
  const agent = MOCK_AGENTS.find((a) => a.name === name);

  if (!agent) {
    return (
      <div className="container mx-auto py-8 max-w-5xl">
        <Button variant="ghost" asChild className="mb-4">
          <Link to="/agents">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Agents
          </Link>
        </Button>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Agent not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-5xl space-y-6">
      <Button variant="ghost" asChild className="mb-2">
        <Link to="/agents">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Agents
        </Link>
      </Button>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-8 w-8 text-primary" />
            {agent.name}
          </h1>
          <p className="text-muted-foreground mt-1">
            Agent definition and configuration details.
          </p>
        </div>
        <Button size="lg" disabled>
          <MessageSquare className="mr-2 h-5 w-5" />
          Chat with this agent
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Prompt</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted p-4 rounded-md whitespace-pre-wrap font-mono text-sm">
                {typeof agent.prompt === "string" ? agent.prompt : "[Dynamic Prompt Function]"}
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="tools" className="w-full">
            <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent">
              <TabsTrigger 
                value="tools" 
                className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2"
              >
                Tools ({agent.tools?.length || 0})
              </TabsTrigger>
              <TabsTrigger 
                value="handoffs" 
                className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2"
              >
                Handoffs ({agent.handoffs?.length || 0})
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="tools" className="pt-4">
              <Card>
                <CardContent className="pt-6">
                  {agent.tools && agent.tools.length > 0 ? (
                    <div className="space-y-4">
                      {agent.tools.map((tool, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Wrench className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{tool.name}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">No tools configured.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="handoffs" className="pt-4">
              <Card>
                <CardContent className="pt-6">
                  {agent.handoffs && agent.handoffs.length > 0 ? (
                    <div className="space-y-6">
                      {agent.handoffs.map((handoff, idx) => (
                        <div key={idx}>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <GitMerge className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium text-primary">
                                {handoff.agent.name}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground pl-6">
                              {handoff.description}
                            </p>
                          </div>
                          {idx < agent.handoffs.length - 1 && <Separator className="my-4" />}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">No handoffs configured.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BrainCircuit className="h-5 w-5" />
                Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm font-medium mb-1 text-muted-foreground">Max Iterations</div>
                <div>{agent.maxIterations || 10}</div>
              </div>
              <Separator />
              <div>
                <div className="text-sm font-medium mb-1 text-muted-foreground">Memory</div>
                {agent.memory ? (
                  <Badge variant="outline" className="capitalize">
                    {agent.memory.type || "unknown"}
                  </Badge>
                ) : (
                  <span className="text-sm">Default (sliding-window)</span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Guardrails
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm font-medium mb-1 text-muted-foreground">Input Guardrails</div>
                <div className="font-medium">{agent.guardrails?.input?.length || 0} configured</div>
              </div>
              <Separator />
              <div>
                <div className="text-sm font-medium mb-1 text-muted-foreground">Output Guardrails</div>
                <div className="font-medium">{agent.guardrails?.output?.length || 0} configured</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
