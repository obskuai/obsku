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
import type { ComponentType, CSSProperties } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

export const mockGraphNodes: GraphNode[] = [
  {
    id: "graph-entry",
    type: "graph-node",
    position: { x: 40, y: 140 },
    data: {
      title: "Support Graph",
      subtitle: "Root graph",
      kind: "graph",
      executionOrder: 1,
      isEntry: true,
      detail: "Routes incoming requests and sets shared execution context.",
    },
  },
  {
    id: "agent-router",
    type: "graph-node",
    position: { x: 360, y: 40 },
    data: {
      title: "Intent Router",
      subtitle: "triage.agent",
      kind: "agent",
      executionOrder: 2,
      detail: "Chooses the next path from issue type, urgency, and user history.",
    },
  },
  {
    id: "function-guard",
    type: "graph-node",
    position: { x: 360, y: 260 },
    data: {
      title: "Policy Guard",
      subtitle: "guardPolicy()",
      kind: "function",
      executionOrder: 3,
      detail: "Evaluates escalation and compliance checks before response generation.",
    },
  },
  {
    id: "agent-responder",
    type: "graph-node",
    position: { x: 700, y: 80 },
    data: {
      title: "Response Agent",
      subtitle: "answer.agent",
      kind: "agent",
      executionOrder: 4,
      detail: "Drafts the final response using retrieved facts and current guard state.",
    },
  },
  {
    id: "function-fallback",
    type: "graph-node",
    position: { x: 700, y: 300 },
    data: {
      title: "Fallback Tool",
      subtitle: "recoverAnswer()",
      kind: "function",
      executionOrder: 5,
      detail: "Builds a conservative answer when routing confidence drops below threshold.",
    },
  },
];

export const mockGraphEdges: GraphEdge[] = [
  {
    id: "edge-entry-router",
    type: "graph-edge",
    source: "graph-entry",
    target: "agent-router",
    data: { condition: "start", isExecutionPath: true },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#0f172a" },
  },
  {
    id: "edge-router-guard",
    type: "graph-edge",
    source: "agent-router",
    target: "function-guard",
    data: { condition: "needs policy check", isExecutionPath: true },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#0f172a" },
  },
  {
    id: "edge-router-responder",
    type: "graph-edge",
    source: "agent-router",
    target: "agent-responder",
    data: { condition: "direct answer", isExecutionPath: true },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#0f172a" },
  },
  {
    id: "edge-guard-responder",
    type: "graph-edge",
    source: "function-guard",
    target: "agent-responder",
    data: { condition: "approved", isExecutionPath: true },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#0f172a" },
  },
  {
    id: "edge-guard-fallback",
    type: "graph-edge",
    source: "function-guard",
    target: "function-fallback",
    data: { condition: "confidence < 0.6" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#0f172a" },
  },
  {
    id: "edge-fallback-router",
    type: "graph-edge",
    source: "function-fallback",
    target: "agent-router",
    data: { condition: "retry with narrowed scope", isBackEdge: true },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b" },
  },
];

export const graphViewport: ReactFlowProps["defaultViewport"] = {
  x: 0,
  y: 0,
  zoom: 0.85,
};

export function isExecutionNode(node: GraphNode): boolean {
  return typeof node.data.executionOrder === "number";
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
  const [nodes, , onNodesChange] = useNodesState<GraphNode>(mockGraphNodes);
  const [edges, , onEdgesChange] = useEdgesState<GraphEdge>(mockGraphEdges);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.18),_transparent_24%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] px-6 py-8 text-slate-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="border-slate-300 bg-white/80 text-slate-700">
              Graph visualization
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Execution graph detail</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Read-only React Flow canvas for agent orchestration, branching conditions,
                back-edges, and execution order.
              </p>
            </div>
          </div>
          <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
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

        <Card className="overflow-hidden border-slate-200/80 bg-white/80 shadow-2xl shadow-slate-200/70 backdrop-blur-sm">
          <CardContent className="grid gap-0 p-0 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="h-[720px] min-h-[65vh] border-b border-slate-200/80 lg:border-r lg:border-b-0">
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
                  Flow legend
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Solid edges mark the primary execution path. Dashed edges show retry or loopback
                  behavior. Labels capture branch conditions directly on the canvas.
                </p>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Execution order
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    Numbered markers highlight the expected traversal sequence for the current mock
                    graph.
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Entry marker
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    The root graph carries a play marker so the starting node reads instantly.
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Read-only v1
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    Pan, zoom, and fit-view are enabled. Node editing and new connections stay
                    disabled.
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default GraphDetail;
