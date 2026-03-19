import { mock } from "bun:test";
import type { CodeInterpreterStreamOutput } from "@aws-sdk/client-bedrock-agentcore";
import {
  InvokeCodeInterpreterCommand,
  StartCodeInterpreterSessionCommand,
  StopCodeInterpreterSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";

export type MockStructuredContent = {
  executionTime?: number;
  exitCode?: number;
  fileNames?: Array<string>;
  files?: Array<{ content?: string; encoding?: string; name?: string }>;
  stderr?: string;
  stdout?: string;
};

/**
 * Returns an AsyncIterable that yields a single CodeInterpreterStreamOutput
 * event whose structuredContent matches the given content.
 */
export function createMockStreamResponse(
  content: MockStructuredContent
): AsyncIterable<CodeInterpreterStreamOutput> {
  return {
    [Symbol.asyncIterator]() {
      let done = false;
      return {
        next(): Promise<IteratorResult<CodeInterpreterStreamOutput>> {
          if (done) {
            return Promise.resolve({
              done: true as const,
              value: undefined as unknown as CodeInterpreterStreamOutput,
            });
          }
          done = true;
          return Promise.resolve({
            done: false,
            value: {
              result: { structuredContent: content },
            } as unknown as CodeInterpreterStreamOutput,
          });
        },
      };
    },
  };
}

export interface MockClientConfig {
  /** Content returned for executeCode / writeFiles invocations */
  executeContent?: MockStructuredContent;
  /** Error thrown for any InvokeCodeInterpreter call */
  invokeError?: Error;
  /** Content returned for listFiles invocation */
  listFilesContent?: MockStructuredContent;
  /** Content returned for readFiles invocation */
  readFilesContent?: MockStructuredContent;
  /** AgentCore session ID returned by StartCodeInterpreterSession */
  sessionId?: string;
  /** Error thrown for StartCodeInterpreterSession */
  startError?: Error;
  /** Error thrown for StopCodeInterpreterSession */
  stopError?: Error;
}

/**
 * Creates a mock BedrockAgentCoreClient.
 * Uses bun:test mock() for the send() spy.
 *
 * Route logic:
 *   StartCodeInterpreterSessionCommand → { sessionId }
 *   InvokeCodeInterpreterCommand (executeCode / writeFiles) → mock stream
 *   InvokeCodeInterpreterCommand (listFiles) → listFilesContent stream
 *   InvokeCodeInterpreterCommand (readFiles) → readFilesContent stream
 *   StopCodeInterpreterSessionCommand → {}
 */
export function createMockClient(config: MockClientConfig = {}) {
  const defaultExecuteContent: MockStructuredContent = {
    executionTime: 50,
    exitCode: 0,
    stderr: "",
    stdout: "",
  };

  const send = mock(async (command: unknown, _opts?: unknown) => {
    if (
      (command as { constructor?: { name?: string } }).constructor?.name ===
      StartCodeInterpreterSessionCommand.name
    ) {
      if (config.startError) {
        throw config.startError;
      }
      return { sessionId: config.sessionId ?? "mock-session-id-123" };
    }

    if (
      (command as { constructor?: { name?: string } }).constructor?.name ===
      InvokeCodeInterpreterCommand.name
    ) {
      if (config.invokeError) {
        throw config.invokeError;
      }
      const cmdName = (command as { input?: { name?: string } }).input?.name;
      if (cmdName === "listFiles") {
        return { stream: createMockStreamResponse(config.listFilesContent ?? {}) };
      }
      if (cmdName === "readFiles") {
        return { stream: createMockStreamResponse(config.readFilesContent ?? {}) };
      }
      // executeCode and writeFiles
      return {
        stream: createMockStreamResponse(config.executeContent ?? defaultExecuteContent),
      };
    }

    if (
      (command as { constructor?: { name?: string } }).constructor?.name ===
      StopCodeInterpreterSessionCommand.name
    ) {
      if (config.stopError) {
        throw config.stopError;
      }
      return {};
    }

    return {};
  });

  const destroy = mock(() => {});

  /** Helper: calls sent for a given command constructor name */
  function callsFor(commandType: string) {
    return send.mock.calls.filter(
      (args) => (args[0] as { constructor: { name: string } }).constructor.name === commandType
    );
  }

  /** Helper: InvokeCodeInterpreter calls filtered by tool name */
  function invokeCallsFor(toolName: string) {
    return send.mock.calls.filter(
      (args) =>
        (args[0] as { constructor?: { name?: string } }).constructor?.name ===
          InvokeCodeInterpreterCommand.name &&
        (args[0] as { input?: { name?: string } }).input?.name === toolName
    );
  }

  return { callsFor, destroy, invokeCallsFor, send };
}

export type MockClient = ReturnType<typeof createMockClient>;
