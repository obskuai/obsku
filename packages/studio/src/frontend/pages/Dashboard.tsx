import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bot, GitGraph, MessageSquare, Activity, Plus, ArrowRight } from "lucide-react";
import type { AgentDisplayInfo, SessionDisplayInfo } from "../../shared/types";

// Mock data for initial display
const mockStats = {
  agents: 5,
  graphs: 2,
  sessions: 12,
  events: 156,
};

const mockRecentSessions: SessionDisplayInfo[] = [
  {
    id: "session-1",
    title: "Weather query conversation",
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    status: "completed",
    messageCount: 8,
  },
  {
    id: "session-2",
    title: "Code review assistance",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    status: "active",
    messageCount: 12,
  },
  {
    id: "session-3",
    title: "Data analysis task",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    status: "completed",
    messageCount: 5,
  },
];

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function getStatusColor(status: SessionDisplayInfo["status"]): string {
  switch (status) {
    case "active":
      return "bg-green-500";
    case "completed":
      return "bg-blue-500";
    case "failed":
      return "bg-red-500";
    case "interrupted":
      return "bg-yellow-500";
    default:
      return "bg-gray-500";
  }
}

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome to Obsku Studio — your agent development dashboard.
          </p>
        </div>
        <Button asChild>
          <Link to="/chat">
            <Plus className="mr-2 h-4 w-4" />
            New Chat
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Agents</CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockStats.agents}</div>
            <p className="text-xs text-muted-foreground">
              Registered agents
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Graphs</CardTitle>
            <GitGraph className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockStats.graphs}</div>
            <p className="text-xs text-muted-foreground">
              Workflow graphs
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sessions</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockStats.sessions}</div>
            <p className="text-xs text-muted-foreground">
              Active conversations
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Events</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockStats.events}</div>
            <p className="text-xs text-muted-foreground">
              Total events tracked
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Sessions</CardTitle>
            <CardDescription>Latest conversation sessions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mockRecentSessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between space-x-4"
                >
                  <div className="flex items-center space-x-4 flex-1 min-w-0">
                    <div className={`w-2 h-2 rounded-full ${getStatusColor(session.status)}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {session.title || `Session ${session.id.slice(0, 8)}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTimeAgo(session.createdAt)} • {session.messageCount} messages
                      </p>
                    </div>
                  </div>
                  <Badge variant={session.status === "active" ? "default" : "secondary"}>
                    {session.status}
                  </Badge>
                </div>
              ))}
            </div>
            <Button variant="ghost" className="w-full mt-4" asChild>
              <Link to="/sessions">
                View all sessions
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks and shortcuts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link to="/agents">
                <Bot className="mr-2 h-4 w-4" />
                Browse Agents
              </Link>
            </Button>
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link to="/graphs">
                <GitGraph className="mr-2 h-4 w-4" />
                View Graphs
              </Link>
            </Button>
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link to="/chat">
                <MessageSquare className="mr-2 h-4 w-4" />
                Start Chat
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
