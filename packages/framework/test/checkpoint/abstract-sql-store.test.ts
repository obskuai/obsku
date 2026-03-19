import { describe, expect, it } from "bun:test";
import {
  AbstractSqlCheckpointStore,
  JsonPlusSerializer,
  type SqlExecutor,
  type StoredMessage,
} from "../../src/checkpoint/index";
import { sqlGetEntityById } from "../../src/checkpoint/ops/sql-entity-ops";

class TestSqlCheckpointStore extends AbstractSqlCheckpointStore {
  constructor(executor: SqlExecutor) {
    super(executor);
  }

  async close(): Promise<void> {}
}

describe("abstract-sql-store characterization", () => {
  it("round-trips messages with tool calls/results through SQL serialization", async () => {
    const serializer = new JsonPlusSerializer();
    const sessions = new Map<
      string,
      {
        created_at: number;
        directory: string;
        id: string;
        metadata: string | null;
        title: string | null;
        updated_at: number;
        workspace_id: string | null;
      }
    >();
    const messages: Array<{
      content: string | null;
      created_at: number;
      id: number;
      role: StoredMessage["role"];
      session_id: string;
      tokens_in: number | null;
      tokens_out: number | null;
      tool_calls: string | null;
      tool_results: string | null;
    }> = [];
    let nextMessageId = 1;

    const queryMessages = () =>
      messages.map((message) => ({
        content: message.content,
        createdAt: message.created_at,
        id: message.id,
        role: message.role,
        sessionId: message.session_id,
        tokensIn: message.tokens_in,
        tokensOut: message.tokens_out,
        toolCalls: message.tool_calls,
        toolResults: message.tool_results,
      }));

    const querySession = (sessionId: string) => sessions.get(sessionId) ?? null;

    const queryLatestMessage = (sessionId: string) => {
      const message = [...messages].reverse().find((entry) => entry.session_id === sessionId);
      return message
        ? {
            content: message.content,
            createdAt: message.created_at,
            id: message.id,
            role: message.role,
            sessionId: message.session_id,
            tokensIn: message.tokens_in,
            tokensOut: message.tokens_out,
            toolCalls: message.tool_calls,
            toolResults: message.tool_results,
          }
        : null;
    };

    const executor = {
      execute(sql, params) {
        if (sql.startsWith("INSERT INTO sessions")) {
          const [id, workspace_id, title, directory, created_at, updated_at, metadata] = params;
          sessions.set(id as string, {
            created_at: created_at as number,
            directory: directory as string,
            id: id as string,
            metadata: (metadata as string | null) ?? null,
            title: (title as string | null) ?? null,
            updated_at: updated_at as number,
            workspace_id: (workspace_id as string | null) ?? null,
          });
          return;
        }

        if (sql.startsWith("INSERT INTO messages")) {
          const [
            session_id,
            role,
            content,
            tool_calls,
            tool_results,
            tokens_in,
            tokens_out,
            created_at,
          ] = params;
          messages.push({
            content: (content as string | null) ?? null,
            created_at: created_at as number,
            id: nextMessageId++,
            role: role as StoredMessage["role"],
            session_id: session_id as string,
            tokens_in: (tokens_in as number | null) ?? null,
            tokens_out: (tokens_out as number | null) ?? null,
            tool_calls: (tool_calls as string | null) ?? null,
            tool_results: (tool_results as string | null) ?? null,
          });
          return;
        }

        if (sql.startsWith("UPDATE sessions SET updated_at = ? WHERE id = ?")) {
          const [updatedAt, id] = params;
          const session = sessions.get(id as string);
          if (session) {
            session.updated_at = updatedAt as number;
          }
        }
      },
      queryAll(sql: string, params: Array<unknown>) {
        if (sql.includes("FROM messages WHERE session_id = ?")) {
          const [sessionId] = params;
          return queryMessages().filter((message) => message.sessionId === sessionId);
        }

        return [];
      },
      queryOne(sql: string, params: Array<unknown>) {
        if (sql.includes("FROM sessions WHERE id = ?")) {
          const [sessionId] = params;
          return querySession(sessionId as string);
        }

        if (sql.includes("FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1")) {
          const [sessionId] = params;
          return queryLatestMessage(sessionId as string);
        }

        return null;
      },
    } as SqlExecutor;

    const store = new TestSqlCheckpointStore(executor);
    const session = await store.createSession("/tmp/test");
    const toolCalls = [
      { input: { city: "nyc", units: "metric" }, name: "weather", toolUseId: "tool-1" },
    ];
    const toolResults = [{ content: "done", status: "success", toolUseId: "tool-1" }];

    const saved = await store.addMessage(session.id, {
      content: "Using tool",
      role: "assistant",
      sessionId: session.id,
      tokensIn: 12,
      tokensOut: 34,
      toolCalls,
      toolResults,
    });
    const messagesAfterRead = await store.getMessages(session.id);

    expect(saved.toolCalls).toEqual(toolCalls);
    expect(saved.toolResults).toEqual(toolResults);
    expect(messagesAfterRead).toEqual([saved]);
    expect(messages[0]?.tool_calls).toBe(serializer.serialize(toolCalls));
    expect(messages[0]?.tool_results).toBe(serializer.serialize(toolResults));
  });

  it("maps snake_case rows and nullish SQL message columns as current behavior", async () => {
    const serializer = new JsonPlusSerializer();
    const sessionRow = {
      created_at: "1704067200000",
      directory: "/tmp/test",
      id: "session-1",
      metadata: serializer.serialize({ nested: { ok: true } }),
      title: null,
      updated_at: "1704067201000",
      workspace_id: null,
    };
    const messageRows = [
      {
        content: null,
        createdAt: "1704067200001",
        id: 1,
        role: "assistant" as const,
        sessionId: "session-1",
        tokensIn: null,
        tokensOut: 8,
        toolCalls: null,
        toolResults: serializer.serialize([{ content: "done", toolUseId: "tool-1" }]),
      },
      {
        content: "second",
        createdAt: 1_704_067_200_002,
        id: 2,
        role: "tool" as const,
        sessionId: "session-1",
        tokensIn: 2,
        tokensOut: null,
        toolCalls: serializer.serialize([]),
        toolResults: serializer.serialize([]),
      },
    ];

    const listSessions = () => [sessionRow];

    const listMessages = () => messageRows;

    const executor = {
      execute() {},
      queryAll(sql: string, _params: Array<unknown>) {
        if (sql.includes("FROM sessions ORDER BY updated_at DESC")) {
          return listSessions();
        }

        if (sql.includes("FROM messages WHERE session_id = ?")) {
          return listMessages();
        }

        return [];
      },
      queryOne(sql: string, _params: Array<unknown>) {
        if (sql.includes("FROM sessions WHERE id = ?")) {
          return sessionRow;
        }

        return null;
      },
    } as SqlExecutor;

    const store = new TestSqlCheckpointStore(executor);
    const session = await store.getSession("session-1");
    const sessions = await store.listSessions();
    const messages = await store.getMessages("session-1");

    expect(session).toEqual({
      createdAt: 1_704_067_200_000,
      directory: "/tmp/test",
      id: "session-1",
      metadata: { nested: { ok: true } },
      title: undefined,
      updatedAt: 1_704_067_201_000,
      workspaceId: undefined,
    });
    expect(sessions).toEqual([session!]);
    expect(messages as unknown).toEqual([
      {
        content: undefined,
        createdAt: 1_704_067_200_001,
        id: 1,
        role: "assistant",
        sessionId: "session-1",
        tokensIn: undefined,
        tokensOut: 8,
        toolCalls: undefined,
        toolResults: [{ content: "done", toolUseId: "tool-1" }],
      },
      {
        content: "second",
        createdAt: 1_704_067_200_002,
        id: 2,
        role: "tool",
        sessionId: "session-1",
        tokensIn: 2,
        tokensOut: undefined,
        toolCalls: [],
        toolResults: [],
      },
    ]);
  });

  it("throws when normalized SQL entity rows are missing required string fields", async () => {
    const executor = {
      async execute() {},
      async queryAll() {
        return [];
      },
      async queryOne() {
        return {
          attributes: "{}",
          created_at: 1,
          id: "entity-1",
          relationships: "[]",
          session_id: "session-1",
          type: "domain",
          updated_at: 2,
          workspace_id: null,
        };
      },
    } as SqlExecutor;

    try {
      await sqlGetEntityById(executor, "entity-1");
      throw new Error("Expected sqlGetEntityById to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('required field "name" is not a string');
    }
  });

  it("throws when normalized SQL entity rows are missing required numeric fields", async () => {
    const executor = {
      async execute() {},
      async queryAll() {
        return [];
      },
      async queryOne() {
        return {
          attributes: "{}",
          created_at: null,
          id: "entity-1",
          name: "example.com",
          relationships: "[]",
          session_id: "session-1",
          type: "domain",
          updated_at: 2,
          workspace_id: null,
        };
      },
    } as SqlExecutor;

    try {
      await sqlGetEntityById(executor, "entity-1");
      throw new Error("Expected sqlGetEntityById to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        'required numeric field "created_at" is null or undefined'
      );
    }
  });
});
