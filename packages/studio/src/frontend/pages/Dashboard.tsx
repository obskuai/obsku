import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Bot, GitGraph, MessageSquare, Activity, Plus, ArrowRight, Loader2 } from "lucide-react";
import type { AgentDisplayInfo, SessionDisplayInfo } from "../../shared/types";
import { listAgents, listGraphs, listSessions } from "../lib/api";

interface DashboardStats {
  agents: number;
  graphs: number;
  sessions: number;
  events: number;
}

function formatTimeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
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
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentSessions, setRecentSessions] = useState<SessionDisplayInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const [agentsRes, graphsRes, sessionsRes] = await Promise.all([
          listAgents(),
          listGraphs(),
          listSessions(1, 5),
        ]);

        if (cancelled) return;

        const totalEvents = sessionsRes.sessions.reduce(
          (sum, s) => sum + s.messageCount,
          0
        );

        setStats({
          agents: agentsRes.agents.length,
          graphs: graphsRes.graphs.length,
          sessions: sessionsRes.total,
          events: totalEvents,
        });
        setRecentSessions(sessionsRes.sessions);
      } catch {
        if (!cancelled) {
          setStats({ agents: 0, graphs: 0, sessions: 0, events: 0 });
          setRecentSessions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDashboard();
    return () => { cancelled = true; };
  }, []);

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

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Agents</CardTitle>
                <Bot className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.agents ?? 0}</div>
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
                <div className="text-2xl font-bold">{stats?.graphs ?? 0}</div>
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
                <div className="text-2xl font-bold">{stats?.sessions ?? 0}</div>
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
                <div className="text-2xl font-bold">{stats?.events ?? 0}</div>
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
                {recentSessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No sessions yet. Start a chat to create one.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {recentSessions.map((session) => (
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
                )}
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
        </>
      )}
    </div>
  );
}
