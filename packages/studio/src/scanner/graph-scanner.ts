import { type CallExpression, type Expression, Node, type ObjectLiteralExpression } from "ts-morph";
import type {
  EdgeDisplayInfo,
  GraphDisplayInfo,
  NodeDisplayInfo,
  NodeType,
} from "../shared/types.js";
import {
  createScanProject,
  expressionToText,
  findExportedObjects,
  getArrayLiteral,
  getBooleanValue,
  getObjectLiteral,
  getPropertyValue,
  getStringValue,
  type ScanOptions,
  unwrapExpression,
} from "./common.js";

export interface GraphScanResult {
  exportName: string;
  filePath: string;
  line: number;
  metadata: GraphDisplayInfo;
  modulePath: string;
}

export function scanGraphs(options: ScanOptions): GraphScanResult[] {
  const project = createScanProject(options.rootDir);
  const results: GraphScanResult[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const matches = findExportedObjects(sourceFile, options.rootDir, matchGraphObject);
    for (const match of matches) {
      results.push({
        exportName: match.exportName,
        filePath: match.filePath,
        line: match.line,
        metadata: extractGraphMetadata(match.objectLiteral),
        modulePath: match.modulePath,
      });
    }
  }

  return results.sort(compareScanResult);
}

function matchGraphObject(expression: Expression): ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression);

  if (Node.isCallExpression(unwrapped) && isGraphFactoryCall(unwrapped)) {
    const firstArgument = unwrapped.getArguments()[0];
    return firstArgument && Node.isObjectLiteralExpression(firstArgument)
      ? firstArgument
      : undefined;
  }

  if (looksLikeGraphDef(unwrapped)) {
    return getObjectLiteral(unwrapped);
  }

  return undefined;
}

function isGraphFactoryCall(expression: CallExpression): boolean {
  return expression.getExpression().getText() === "graph";
}

function looksLikeGraphDef(expression: Expression): boolean {
  const objectLiteral = getObjectLiteral(expression);
  if (!objectLiteral) {
    return false;
  }

  return Boolean(
    getPropertyValue(objectLiteral, "entry") &&
      getPropertyValue(objectLiteral, "nodes") &&
      getPropertyValue(objectLiteral, "edges")
  );
}

function extractGraphMetadata(objectLiteral: ObjectLiteralExpression): GraphDisplayInfo {
  const nodes = extractNodes(objectLiteral);
  const allEdges = extractEdges(objectLiteral);
  const edges = allEdges.filter((edge) => !edge.back);
  const backEdges = allEdges.filter((edge) => edge.back);
  const entry = getStringValue(getPropertyValue(objectLiteral, "entry")) ?? "";

  return {
    backEdges,
    edges,
    entry,
    executionOrder: computeExecutionOrder(nodes, edges, entry),
    nodes,
  };
}

function extractNodes(objectLiteral: ObjectLiteralExpression): Record<string, NodeDisplayInfo> {
  const nodesArray = getArrayLiteral(getPropertyValue(objectLiteral, "nodes"));
  if (!nodesArray) {
    return {};
  }

  const nodes: Record<string, NodeDisplayInfo> = {};
  for (const element of nodesArray.getElements()) {
    if (Node.isSpreadElement(element)) {
      continue;
    }

    const nodeObject = getObjectLiteral(element as Expression);
    if (!nodeObject) {
      continue;
    }

    const id = getStringValue(getPropertyValue(nodeObject, "id"));
    if (!id) {
      continue;
    }

    nodes[id] = {
      description: getStringValue(getPropertyValue(nodeObject, "description")),
      id,
      type: classifyNodeType(getPropertyValue(nodeObject, "executor")),
    };
  }

  return nodes;
}

function classifyNodeType(expression: Expression | undefined): NodeType {
  const unwrapped = expression ? unwrapExpression(expression) : undefined;
  if (!unwrapped) {
    return "fn";
  }

  if (Node.isCallExpression(unwrapped)) {
    const callee = unwrapped.getExpression().getText();
    if (callee === "agent" || callee === "createAgent") {
      return "agent";
    }
    if (callee === "graph") {
      return "graph";
    }
  }

  const objectLiteral = getObjectLiteral(unwrapped);
  if (objectLiteral) {
    if (getPropertyValue(objectLiteral, "prompt") && getPropertyValue(objectLiteral, "name")) {
      return "agent";
    }
    if (getPropertyValue(objectLiteral, "nodes") && getPropertyValue(objectLiteral, "edges")) {
      return "graph";
    }
  }

  const text = expressionToText(unwrapped) ?? "";
  const textLower = text.toLowerCase();
  if (textLower.includes("agent") || text.includes("AgentDef")) {
    return "agent";
  }
  if (textLower.includes("graph") || text.includes("Graph")) {
    return "graph";
  }

  return "fn";
}

function extractEdges(objectLiteral: ObjectLiteralExpression): EdgeDisplayInfo[] {
  const edgesArray = getArrayLiteral(getPropertyValue(objectLiteral, "edges"));
  if (!edgesArray) {
    return [];
  }

  return edgesArray.getElements().flatMap((element) => {
    if (Node.isSpreadElement(element)) {
      return [];
    }

    const edgeObject = getObjectLiteral(element as Expression);
    if (!edgeObject) {
      return [];
    }

    const from = getStringValue(getPropertyValue(edgeObject, "from"));
    const to = getStringValue(getPropertyValue(edgeObject, "to"));
    if (!from || !to) {
      return [];
    }

    return [
      {
        back: getBooleanValue(getPropertyValue(edgeObject, "back")) || undefined,
        from,
        to,
      },
    ];
  });
}

function computeExecutionOrder(
  nodes: Record<string, NodeDisplayInfo>,
  edges: EdgeDisplayInfo[],
  entry: string
): string[] {
  const nodeIds = Object.keys(nodes);
  if (nodeIds.length === 0) {
    return [];
  }

  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const adjacency = new Map(nodeIds.map((id) => [id, [] as string[]]));

  for (const edge of edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) {
      continue;
    }
    adjacency.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const queue = [...nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0)].sort();
  if (entry && queue.includes(entry)) {
    queue.splice(queue.indexOf(entry), 1);
    queue.unshift(entry);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    order.push(current);

    for (const next of adjacency.get(current) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }

  for (const id of nodeIds.sort()) {
    if (!order.includes(id)) {
      order.push(id);
    }
  }

  return order;
}

function compareScanResult(left: GraphScanResult, right: GraphScanResult): number {
  return left.filePath.localeCompare(right.filePath) || left.line - right.line;
}
