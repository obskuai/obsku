import { type CallExpression, type Expression, Node, type ObjectLiteralExpression } from "ts-morph";
import type { AgentDisplayInfo, MemoryDisplayInfo, ToolDisplayInfo } from "../shared/types.js";
import {
  createScanProject,
  expressionToText,
  findExportedObjects,
  getArrayLiteral,
  getBooleanValue,
  getNumberValue,
  getObjectLiteral,
  getPropertyValue,
  getStringValue,
  type ScanOptions,
  unwrapExpression,
} from "./common.js";

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_STREAMING = false;
const DEFAULT_TOOL_CONCURRENCY = 3;
const DEFAULT_TOOL_TIMEOUT = 30_000;
const PROMPT_PREVIEW_LIMIT = 160;

export interface AgentHandoffInfo {
  agent: string;
  description?: string;
}

export interface AgentGuardrailInfo {
  input: number;
  output: number;
}

export interface AgentMemoryScanInfo {
  contextInjection?: boolean;
  enabled?: boolean;
  entityMemory?: boolean;
  longTermMemory?: boolean;
  maxContextLength?: number;
  maxEntitiesPerSession?: number;
  maxFactsToInject?: number;
  maxMessages?: number;
  raw: string;
  type: MemoryDisplayInfo["type"];
}

export interface AgentScanMetadata extends AgentDisplayInfo {
  guardrails: AgentGuardrailInfo;
  handoffs: AgentHandoffInfo[];
  memoryConfig?: AgentMemoryScanInfo;
  prompt: string;
}

export interface AgentScanResult {
  exportName: string;
  filePath: string;
  line: number;
  metadata: AgentScanMetadata;
  modulePath: string;
}

export function scanAgents(options: ScanOptions): AgentScanResult[] {
  const project = createScanProject(options.rootDir);
  const results: AgentScanResult[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const matches = findExportedObjects(sourceFile, options.rootDir, matchAgentObject);
    for (const match of matches) {
      results.push({
        exportName: match.exportName,
        filePath: match.filePath,
        line: match.line,
        metadata: extractAgentMetadata(match.objectLiteral),
        modulePath: match.modulePath,
      });
    }
  }

  return results.sort(compareScanResult);
}

function matchAgentObject(expression: Expression): ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression);

  if (Node.isCallExpression(unwrapped) && isAgentFactoryCall(unwrapped)) {
    const firstArgument = unwrapped.getArguments()[0];
    return firstArgument && Node.isObjectLiteralExpression(firstArgument)
      ? firstArgument
      : undefined;
  }

  if (looksLikeAgentDef(unwrapped)) {
    return getObjectLiteral(unwrapped);
  }

  return undefined;
}

function isAgentFactoryCall(expression: CallExpression): boolean {
  const callee = expression.getExpression().getText();
  return callee === "agent" || callee === "createAgent";
}

function looksLikeAgentDef(expression: Expression): boolean {
  const objectLiteral = getObjectLiteral(expression);
  if (!objectLiteral) {
    return false;
  }

  return Boolean(
    getPropertyValue(objectLiteral, "name") && getPropertyValue(objectLiteral, "prompt")
  );
}

function extractAgentMetadata(objectLiteral: ObjectLiteralExpression): AgentScanMetadata {
  const prompt = extractPrompt(objectLiteral);
  const tools = extractTools(objectLiteral);
  const memoryConfig = extractMemoryConfig(objectLiteral);
  const guardrails = extractGuardrails(objectLiteral);
  const handoffs = extractHandoffs(objectLiteral);

  return {
    guardrails,
    guardrailsCount: guardrails,
    handoffs,
    handoffsCount: handoffs.length,
    maxIterations:
      getNumberValue(getPropertyValue(objectLiteral, "maxIterations")) ?? DEFAULT_MAX_ITERATIONS,
    memory: memoryConfig,
    memoryConfig,
    name: getStringValue(getPropertyValue(objectLiteral, "name")) ?? "unknown",
    prompt,
    promptPreview: truncatePrompt(prompt),
    streaming: getBooleanValue(getPropertyValue(objectLiteral, "streaming")) ?? DEFAULT_STREAMING,
    toolConcurrency:
      getNumberValue(getPropertyValue(objectLiteral, "toolConcurrency")) ??
      DEFAULT_TOOL_CONCURRENCY,
    toolTimeout:
      getNumberValue(getPropertyValue(objectLiteral, "toolTimeout")) ?? DEFAULT_TOOL_TIMEOUT,
    tools,
  };
}

function extractPrompt(objectLiteral: ObjectLiteralExpression): string {
  const promptExpression = getPropertyValue(objectLiteral, "prompt");
  return getStringValue(promptExpression) ?? expressionToText(promptExpression) ?? "";
}

function extractTools(objectLiteral: ObjectLiteralExpression): ToolDisplayInfo[] {
  const toolsArray = getArrayLiteral(getPropertyValue(objectLiteral, "tools"));
  if (!toolsArray) {
    return [];
  }

  return toolsArray
    .getElements()
    .map((element) =>
      Node.isSpreadElement(element) ? undefined : extractToolInfo(element as Expression)
    )
    .filter((tool): tool is ToolDisplayInfo => tool !== undefined);
}

function extractToolInfo(expression: Expression | undefined): ToolDisplayInfo | undefined {
  const unwrapped = expression ? unwrapExpression(expression) : undefined;
  if (!unwrapped) {
    return undefined;
  }

  if (Node.isIdentifier(unwrapped)) {
    return { name: unwrapped.getText() };
  }

  if (Node.isPropertyAccessExpression(unwrapped)) {
    return { name: unwrapped.getName() };
  }

  if (Node.isCallExpression(unwrapped)) {
    return { name: unwrapped.getExpression().getText() };
  }

  const objectLiteral = getObjectLiteral(unwrapped);
  if (!objectLiteral) {
    return { name: unwrapped.getText() };
  }

  const wrappedTool = getPropertyValue(objectLiteral, "tool");
  if (wrappedTool) {
    return extractToolInfo(wrappedTool);
  }

  const name = getStringValue(getPropertyValue(objectLiteral, "name"));
  if (!name) {
    return { name: objectLiteral.getText() };
  }

  return {
    description: getStringValue(getPropertyValue(objectLiteral, "description")),
    name,
  };
}

function extractMemoryConfig(
  objectLiteral: ObjectLiteralExpression
): AgentMemoryScanInfo | undefined {
  const memoryExpression = getPropertyValue(objectLiteral, "memory");
  if (!memoryExpression) {
    return undefined;
  }

  const memoryObject = getObjectLiteral(memoryExpression);
  if (!memoryObject) {
    return {
      raw: expressionToText(memoryExpression) ?? "memory",
      type: "custom",
    };
  }

  const maxMessages = getNumberValue(getPropertyValue(memoryObject, "maxMessages"));
  return {
    contextInjection: getBooleanValue(getPropertyValue(memoryObject, "contextInjection")),
    enabled: getBooleanValue(getPropertyValue(memoryObject, "enabled")),
    entityMemory: getBooleanValue(getPropertyValue(memoryObject, "entityMemory")),
    longTermMemory: getBooleanValue(getPropertyValue(memoryObject, "longTermMemory")),
    maxContextLength: getNumberValue(getPropertyValue(memoryObject, "maxContextLength")),
    maxEntitiesPerSession: getNumberValue(getPropertyValue(memoryObject, "maxEntitiesPerSession")),
    maxFactsToInject: getNumberValue(getPropertyValue(memoryObject, "maxFactsToInject")),
    maxMessages,
    raw: memoryObject.getText(),
    type: classifyMemoryType(memoryObject),
  };
}

function classifyMemoryType(objectLiteral: ObjectLiteralExpression): MemoryDisplayInfo["type"] {
  const enabled = getBooleanValue(getPropertyValue(objectLiteral, "enabled"));
  if (enabled === false) {
    return "none";
  }

  if (getPropertyValue(objectLiteral, "maxMessages")) {
    return "buffer";
  }

  if (
    getPropertyValue(objectLiteral, "longTermMemory") ||
    getPropertyValue(objectLiteral, "entityMemory")
  ) {
    return "summarization";
  }

  return "custom";
}

function extractGuardrails(objectLiteral: ObjectLiteralExpression): AgentGuardrailInfo {
  const guardrailsObject = getObjectLiteral(getPropertyValue(objectLiteral, "guardrails"));
  return {
    input: countArrayElements(guardrailsObject, "input"),
    output: countArrayElements(guardrailsObject, "output"),
  };
}

function extractHandoffs(objectLiteral: ObjectLiteralExpression): AgentHandoffInfo[] {
  const handoffArray = getArrayLiteral(getPropertyValue(objectLiteral, "handoffs"));
  if (!handoffArray) {
    return [];
  }

  return handoffArray
    .getElements()
    .map((element) => {
      if (Node.isSpreadElement(element)) {
        return undefined;
      }

      const handoffObject = getObjectLiteral(element as Expression);
      if (!handoffObject) {
        return { agent: element.getText() };
      }

      const agentExpression = getPropertyValue(handoffObject, "agent");
      const agentObject = getObjectLiteral(agentExpression);
      return {
        agent:
          getStringValue(getPropertyValue(agentObject ?? handoffObject, "name")) ??
          expressionToText(agentExpression) ??
          "unknown",
        description: getStringValue(getPropertyValue(handoffObject, "description")),
      };
    })
    .filter((handoff): handoff is AgentHandoffInfo => handoff !== undefined);
}

function countArrayElements(
  objectLiteral: ObjectLiteralExpression | undefined,
  propertyName: string
): number {
  if (!objectLiteral) {
    return 0;
  }

  return getArrayLiteral(getPropertyValue(objectLiteral, propertyName))?.getElements().length ?? 0;
}

function truncatePrompt(prompt: string): string {
  if (prompt.length <= PROMPT_PREVIEW_LIMIT) {
    return prompt;
  }

  return `${prompt.slice(0, PROMPT_PREVIEW_LIMIT - 3)}...`;
}

function compareScanResult(left: AgentScanResult, right: AgentScanResult): number {
  return left.filePath.localeCompare(right.filePath) || left.line - right.line;
}
