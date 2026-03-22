import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, Bot, ArrowRight } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const MOCK_AGENTS = [
  {
    name: "customer-support-bot",
    prompt: "You are a helpful customer support agent. Help users with their orders and returns.",
    tools: [{ name: "search_knowledge_base" }, { name: "issue_refund" }, { name: "check_order_status" }],
    maxIterations: 10,
    memory: { type: "sliding-window", maxMessages: 50 },
    guardrails: { input: [() => {}], output: [() => {}] },
    handoffs: [{ agent: { name: "human-escalation-agent", prompt: "..." }, description: "Escalate to a human agent" }]
  },
  {
    name: "code-reviewer",
    prompt: "Review the provided code for security vulnerabilities, performance issues, and style violations.",
    tools: [{ name: "read_file" }, { name: "run_linter" }],
    maxIterations: 5,
    memory: { type: "buffer" },
    guardrails: { input: [], output: [] },
    handoffs: []
  },
  {
    name: "data-analyst",
    prompt: "Analyze the dataset and provide a summary of key metrics and trends.",
    tools: [{ name: "query_sql" }, { name: "generate_chart" }, { name: "export_csv" }, { name: "python_interpreter" }],
    maxIterations: 15,
    memory: undefined,
    guardrails: undefined,
    handoffs: []
  }
];

export default function AgentList() {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredAgents = MOCK_AGENTS.filter((agent) =>
    agent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (typeof agent.prompt === "string" && agent.prompt.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="container mx-auto py-8 max-w-5xl space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-8 w-8 text-primary" />
            Agents
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage and monitor your defined agents.
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search agents..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prompt Snippet</TableHead>
              <TableHead>Tools</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAgents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No agents found.
                </TableCell>
              </TableRow>
            ) : (
              filteredAgents.map((agent) => (
                <TableRow key={agent.name}>
                  <TableCell className="font-medium">
                    <Link to={`/agents/${agent.name}`} className="hover:underline text-primary">
                      {agent.name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">
                    {typeof agent.prompt === "string" ? agent.prompt : "Dynamic Prompt..."}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {agent.tools?.length || 0} tools
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/agents/${agent.name}`}>
                        View Details
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
