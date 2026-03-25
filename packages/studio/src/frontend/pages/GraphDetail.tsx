import "@xyflow/react/dist/style.css";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  type EdgeTypes,
  getBezierPath,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  type ReactFlowProps,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { Bot, FunctionSquare, GitBranch, Play, Workflow } from "lucide-react";
import { type ComponentType, type CSSProperties, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { ApiError, getGraph } from "../lib/api";
import { cn } from "../lib/utils";

type GraphNodeKind = "agent" | "graph" | "function";

type GraphNodeData = {
  title: string;
  subtitle: string;
  kind: GraphNodeKind;
  executionOrder?: number;
  isEntry?: boolean;
  detail: string;
};

type GraphEdgeData = {
  condition: string;
  isBackEdge?: boolean;
  isExecutionPath?: boolean;
};

export type GraphNode = Node<GraphNodeData, "graph-node">;
export type GraphEdge = Edge<GraphEdgeData, "graph-edge">;

const nodeTone: Record<
  GraphNodeKind,
  {
    badge: string;
    border: string;
    icon: ComponentType<{ className?: string }>;
    minimap: string;
    glow: string;
  }
> = {
  agent: {
    badge: "border-sky-300 bg-sky-100 text-sky-900",
    border: "border-sky-300/80",
    icon: Bot,
    minimap: "#0ea5e9",
    glow: "shadow-sky-200/80",
  },
  graph: {
    badge: "border-emerald-300 bg-emerald-100 text-emerald-900",
    border: "border-emerald-300/80",
    icon: Workflow,
    minimap: "#10b981",
    glow: "shadow-emerald-200/80",
  },
  function: {
    badge: "border-amber-300 bg-amber-100 text-amber-900",
    border: "border-amber-300/80",
    icon: FunctionSquare,
    minimap: "#f59e0b",
    glow: "shadow-amber-200/80",
  },
};

export const graphViewport: ReactFlowProps["defaultViewport"] = {
  x: 0,
  y: 0,
  zoom: 0.85,
};

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "Graph not found.";
    }

    return error.message;
  }

  return "Could not load graph details.";
}

function toGraphNodeKind(value: "agent" | "graph" | "fn"): GraphNodeKind {
  return value === "fn" ? "function" : value;
}

function buildGraphNodes(graph: Awaited<ReturnType<typeof getGraph>>["graph"]): GraphNode[] {
  const ids = graph.executionOrder.length > 0 ? graph.executionOrder : Object.keys(graph.nodes);
  const gapX = 320;
  const gapY = 180;

  return ids.map((id, index) => {
    const node = graph.nodes[id];
    const column = index % 3;
    const row = Math.floor(index / 3);

    return {
      id,
      type: "graph-node",
      position: { x: 40 + column * gapX, y: 60 + row * gapY },
      data: {
        title: node.id,
        subtitle: node.status ?? `${node.type} node`,
        kind: toGraphNodeKind(node.type),
        executionOrder:
          graph.executionOrder.indexOf(id) >= 0 ? graph.executionOrder.indexOf(id) + 1 : undefined,
        isEntry: graph.entry === id,
        detail: node.description ?? "No description provided.",
      },
    };
  });
}

function buildGraphEdges(graph: Awaited<ReturnType<typeof getGraph>>["graph"]): GraphEdge[] {
  return [...graph.edges, ...graph.backEdges].map((edge, index) => ({
    id: `${edge.from}-${edge.to}-${index}`,
    type: "graph-edge",
    source: edge.from,
    target: edge.to,
    data: {
      condition: edge.back ? "loopback" : `path ${index + 1}`,
      isBackEdge: edge.back ?? false,
      isExecutionPath: !(edge.back ?? false),
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edge.back ? "#64748b" : "#0f172a",
    },
  }));
}

function GraphNodeCard({ data }: NodeProps<GraphNode>) {
  const tone = nodeTone[data.kind];
  const Icon = tone.icon;

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-slate-300 !bg-white opacity-0"
        isConnectable={false}
      />
      <Card
        className={cn(
          "w-[260px] border bg-white/95 shadow-lg backdrop-blur-sm transition-shadow",
          tone.border,
          tone.glow,
          data.executionOrder ? "ring-2 ring-slate-900/10" : "",
          data.isEntry ? "ring-2 ring-emerald-500/30" : ""
        )}
      >
        <CardHeader className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className={cn("rounded-lg border p-2", tone.badge)}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold text-slate-950">{data.title}</CardTitle>
                <CardDescription className="mt-1 text-xs text-slate-500">
                  {data.subtitle}
                </CardDescription>
              </div>
            </div>
            {data.executionOrder ? (
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-slate-950 text-xs font-semibold text-white">
                {data.executionOrder}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn("capitalize", tone.badge)}>
              {data.kind}
            </Badge>
            {data.isEntry ? (
              <Badge
                variant="outline"
                className="border-emerald-300 bg-emerald-50 text-emerald-800"
              >
                <Play className="mr-1 h-3 w-3" />
                Entry point
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 text-xs leading-5 text-slate-600">
          {data.detail}
        </CardContent>
      </Card>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-slate-300 !bg-white opacity-0"
        isConnectable={false}
      />
    </>
  );
}

function GraphEdgePath({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<GraphEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: data?.isBackEdge ? 0.45 : 0.2,
  });

  const style: CSSProperties = data?.isBackEdge
    ? { stroke: "#64748b", strokeDasharray: "8 6", strokeWidth: 2 }
    : data?.isExecutionPath
      ? { stroke: "#0f172a", strokeWidth: 2.5 }
      : { stroke: "#94a3b8", strokeWidth: 2 };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      <EdgeLabelRenderer>
        <div
          className={cn(
            "pointer-events-none absolute rounded-full border px-2 py-1 text-[11px] font-medium shadow-sm",
            data?.isExecutionPath
              ? "border-slate-300 bg-white text-slate-900"
              : data?.isBackEdge
                ? "border-slate-300 bg-slate-100 text-slate-600"
                : "border-slate-200 bg-white text-slate-500"
          )}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {data?.condition}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const graphNodeTypes: NodeTypes = {
  "graph-node": GraphNodeCard as ComponentType<NodeProps>,
};

export const graphEdgeTypes: EdgeTypes = {
  "graph-edge": GraphEdgePath,
};

export function graphMiniMapNodeColor(node: GraphNode) {
  return nodeTone[node.data.kind].minimap;
}

function GraphDetail() {
  const { id } = useParams<{ id: string }>();
  const [graph, setGraph] = useState<Awaited<ReturnType<typeof getGraph>>["graph"] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("Graph not found.");
      setIsLoading(false);
      return;
    }

    const graphId = id;
    let isMounted = true;

    async function loadGraph() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getGraph(graphId);
        if (isMounted) {
          setGraph(response.graph);
        }
      } catch (loadError) {
        if (isMounted) {
          setGraph(null);
          setError(getErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadGraph();

    return () => {
      isMounted = false;
    };
  }, [id]);

  const graphNodes = useMemo(() => (graph ? buildGraphNodes(graph) : []), [graph]);
  const graphEdges = useMemo(() => (graph ? buildGraphEdges(graph) : []), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<GraphEdge>([]);

  useEffect(() => {
    setNodes(graphNodes);
  }, [graphNodes, setNodes]);

  useEffect(() => {
    setEdges(graphEdges);
  }, [graphEdges, setEdges]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.18),_transparent_24%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] px-6 py-8 text-slate-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="border-slate-300 bg-white/80 text-slate-700">
              Graph visualization
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {graph ? `Graph ${id}` : "Execution graph detail"}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Live graph data from the Studio API with branching, loopbacks, and execution order.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600 sm:grid-cols-3">
            <Badge
              variant="outline"
              className="justify-center border-sky-300 bg-sky-50 text-sky-800"
            >
              Agent node
            </Badge>
            <Badge
              variant="outline"
              className="justify-center border-emerald-300 bg-emerald-50 text-emerald-800"
            >
              Graph node
            </Badge>
            <Badge
              variant="outline"
              className="justify-center border-amber-300 bg-amber-50 text-amber-800"
            >
              Function node
            </Badge>
          </div>
        </div>

        {isLoading ? (
          <Card className="border-slate-200/80 bg-white/80 shadow-2xl shadow-slate-200/70 backdrop-blur-sm">
            <CardContent className="py-16 text-center text-muted-foreground">
              Loading graph...
            </CardContent>
          </Card>
        ) : error || !graph ? (
          <Card className="border-slate-200/80 bg-white/80 shadow-2xl shadow-slate-200/70 backdrop-blur-sm">
            <CardContent className="space-y-4 py-16 text-center text-muted-foreground">
              <div>{error ?? "Graph not found."}</div>
              <Button variant="outline" asChild>
                <Link to="/graphs">Back to graphs</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden border-slate-200/80 bg-white/80 shadow-2xl shadow-slate-200/70 backdrop-blur-sm">
            <CardContent className="grid gap-0 p-0 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="h-[720px] min-h-[65vh] border-b border-slate-200/80 lg:border-b-0 lg:border-r">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={graphNodeTypes}
                  edgeTypes={graphEdgeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  fitView
                  fitViewOptions={{ padding: 0.2 }}
                  defaultViewport={graphViewport}
                  minZoom={0.4}
                  maxZoom={1.5}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable
                  proOptions={{ hideAttribution: true }}
                  aria-label="Execution graph"
                >
                  <Background
                    gap={24}
                    size={1}
                    color="rgba(148, 163, 184, 0.35)"
                    variant={BackgroundVariant.Dots}
                  />
                  <MiniMap
                    pannable
                    zoomable
                    nodeColor={graphMiniMapNodeColor}
                    className="!border !border-slate-200 !bg-white/95"
                  />
                  <Controls className="!shadow-lg" showInteractive={false} />
                </ReactFlow>
              </div>

              <div className="space-y-5 p-5">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <GitBranch className="h-4 w-4 text-slate-500" />
                    Flow summary
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Primary edges are solid, loopbacks are dashed, and node badges reflect the live
                    graph structure returned by the backend.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Node count
                    </div>
                    <div className="mt-2 text-sm text-slate-700">{graphNodes.length} nodes</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Edge count
                    </div>
                    <div className="mt-2 text-sm text-slate-700">{graphEdges.length} edges</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Entry node
                    </div>
                    <div className="mt-2 text-sm text-slate-700">{graph.entry}</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default GraphDetail;
