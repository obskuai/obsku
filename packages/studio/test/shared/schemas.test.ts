import { describe, expect, test } from "bun:test";
import {
  AgentDetailResponse,
  AgentDisplaySchema,
  AgentListResponse,
  ChatRequest,
  ChatResponse,
  ErrorResponse,
  EventDisplaySchema,
  GraphDetailResponse,
  GraphDisplaySchema,
  GraphListResponse,
  SessionDetailResponse,
  SessionDisplaySchema,
  SessionListResponse,
} from "../../src/shared/schemas";

describe("Agent schemas", () => {
  const validAgent = {
    name: "test-agent",
    promptPreview: "Test prompt preview",
    tools: [{ name: "tool1", description: "Tool 1" }],
    memory: { type: "summarization" as const, maxMessages: 100 },
    guardrailsCount: { input: 1, output: 2 },
    handoffsCount: 3,
    maxIterations: 10,
    streaming: true,
    toolTimeout: 30000,
    toolConcurrency: 3,
  };

  test("AgentDisplaySchema accepts valid agent", () => {
    const result = AgentDisplaySchema.safeParse(validAgent);
    expect(result.success).toBe(true);
  });

  test("AgentDisplaySchema rejects missing required fields", () => {
    const invalid = { ...validAgent, name: undefined };
    const result = AgentDisplaySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("AgentDisplaySchema rejects invalid memory type", () => {
    const invalid = { ...validAgent, memory: { type: "invalid" } };
    const result = AgentDisplaySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("AgentListResponse accepts valid response", () => {
    const response = {
      success: true as const,
      agents: [validAgent],
    };
    const result = AgentListResponse.safeParse(response);
    expect(result.success).toBe(true);
  });

  test("AgentListResponse rejects missing agents", () => {
    const response = { success: true as const };
    const result = AgentListResponse.safeParse(response);
    expect(result.success).toBe(false);
  });

  test("AgentDetailResponse accepts valid response", () => {
    const response = {
      success: true as const,
      agent: validAgent,
    };
    const result = AgentDetailResponse.safeParse(response);
    expect(result.success).toBe(true);
  });
});

describe("Graph schemas", () => {
  const validGraph = {
    nodes: {
      node1: { id: "node1", description: "Node 1", type: "agent" as const },
      node2: { id: "node2", type: "fn" as const },
    },
    edges: [{ from: "node1", to: "node2" }],
    backEdges: [],
    executionOrder: ["node1", "node2"],
    entry: "node1",
  };

  test("GraphDisplaySchema accepts valid graph", () => {
    const result = GraphDisplaySchema.safeParse(validGraph);
    expect(result.success).toBe(true);
  });

  test("GraphDisplaySchema rejects missing entry", () => {
    const invalid = { ...validGraph, entry: undefined };
    const result = GraphDisplaySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("GraphDisplaySchema rejects invalid node type", () => {
    const invalid = {
      ...validGraph,
      nodes: { node1: { id: "node1", type: "invalid" } },
    };
    const result = GraphDisplaySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("GraphListResponse accepts valid response", () => {
    const response = {
      success: true as const,
      graphs: [{ id: "g1", name: "Graph 1", nodeCount: 2, edgeCount: 1 }],
    };
    const result = GraphListResponse.safeParse(response);
    expect(result.success).toBe(true);
  });

  test("GraphDetailResponse accepts valid response", () => {
    const response = {
      success: true as const,
      graph: validGraph,
    };
    const result = GraphDetailResponse.safeParse(response);
    expect(result.success).toBe(true);
  });
});

describe("Session schemas", () => {
  const validSession = {
    id: "session-1",
    title: "Test Session",
    createdAt: Date.now(),
    status: "active" as const,
    messageCount: 5,
  };

  test("SessionDisplaySchema accepts valid session", () => {
    const result = SessionDisplaySchema.safeParse(validSession);
    expect(result.success).toBe(true);
  });

  test("SessionDisplaySchema rejects invalid status", () => {
    const invalid = { ...validSession, status: "invalid" };
    const result = SessionDisplaySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("SessionListResponse accepts valid response", () => {
    const response = {
      success: true as const,
      sessions: [validSession],
    };
    const result = SessionListResponse.safeParse(response);
    expect(result.success).toBe(true);
  });

  test("SessionDetailResponse accepts valid response", () => {
    const response = {
      success: true as const,
      session: validSession,
      messages: [
        {
          id: "msg-1",
          role: "user" as const,
          content: "Hello",
          timestamp: Date.now(),
        },
      ],
    };
    const result = SessionDetailResponse.safeParse(response);
    expect(result.success).toBe(true);
  });
});

describe("Chat schemas", () => {
  test("ChatRequest accepts valid request", () => {
    const request = {
      message: "Hello",
      sessionId: "session-1",
      agentName: "agent-1",
      stream: true,
    };
    const result = ChatRequest.safeParse(request);
    expect(result.success).toBe(true);
  });

  test("ChatRequest rejects empty message", () => {
    const request = { agentName: "agent-1", message: "" };
    const result = ChatRequest.safeParse(request);
    expect(result.success).toBe(false);
  });

  test("ChatRequest requires agentName", () => {
    const request = { message: "Hello" };
    const result = ChatRequest.safeParse(request);
    expect(result.success).toBe(false);
  });

  test("ChatResponse accepts valid response", () => {
    const response = {
      success: true as const,
      message: {
        id: "msg-1",
        role: "assistant" as const,
        content: "Hello back",
        timestamp: Date.now(),
      },
      sessionId: "session-1",
    };
    const result = ChatResponse.safeParse(response);
    expect(result.success).toBe(true);
  });
});

describe("Event schemas", () => {
  const validEvent = {
    type: "agent.thinking",
    category: "agent" as const,
    timestamp: Date.now(),
    data: { content: "Thinking..." },
    severity: "info" as const,
  };

  test("EventDisplaySchema accepts valid event", () => {
    const result = EventDisplaySchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  test("EventDisplaySchema accepts all valid categories", () => {
    const categories = [
      "session",
      "agent",
      "tool",
      "graph",
      "background",
      "checkpoint",
      "guardrail",
      "handoff",
      "supervisor",
      "context",
      "error",
      "stream",
    ] as const;

    for (const category of categories) {
      const event = { ...validEvent, category };
      const result = EventDisplaySchema.safeParse(event);
      expect(result.success).toBe(true);
    }
  });

  test("EventDisplaySchema accepts all valid severities", () => {
    const severities = ["info", "success", "warning", "error"] as const;

    for (const severity of severities) {
      const event = { ...validEvent, severity };
      const result = EventDisplaySchema.safeParse(event);
      expect(result.success).toBe(true);
    }
  });

  test("EventDisplaySchema rejects invalid category", () => {
    const invalid = { ...validEvent, category: "invalid" };
    const result = EventDisplaySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("EventDisplaySchema rejects invalid severity", () => {
    const invalid = { ...validEvent, severity: "critical" };
    const result = EventDisplaySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("Error schema", () => {
  test("ErrorResponse accepts valid error", () => {
    const response = {
      success: false as const,
      error: {
        code: "NOT_FOUND",
        message: "Agent not found",
      },
    };
    const result = ErrorResponse.safeParse(response);
    expect(result.success).toBe(true);
  });

  test("ErrorResponse accepts error with details", () => {
    const response = {
      success: false as const,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        details: { field: "name", issue: "required" },
      },
    };
    const result = ErrorResponse.safeParse(response);
    expect(result.success).toBe(true);
  });

  test("ErrorResponse rejects success: true", () => {
    const response = {
      success: true as const,
      error: { code: "ERROR", message: "Error" },
    };
    const result = ErrorResponse.safeParse(response);
    expect(result.success).toBe(false);
  });
});

describe("Edge cases", () => {
  test("handles null values gracefully", () => {
    const result = AgentDisplaySchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  test("handles undefined gracefully", () => {
    const result = AgentDisplaySchema.safeParse(undefined);
    expect(result.success).toBe(false);
  });

  test("handles arrays instead of objects", () => {
    const result = AgentDisplaySchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  test("handles wrong types", () => {
    const result = AgentDisplaySchema.safeParse("string");
    expect(result.success).toBe(false);
  });

  test("handles extra fields (strip by default)", () => {
    const agent = {
      name: "test",
      promptPreview: "Test",
      tools: [],
      guardrailsCount: { input: 0, output: 0 },
      handoffsCount: 0,
      maxIterations: 10,
      streaming: false,
      toolTimeout: 30000,
      toolConcurrency: 3,
      extraField: "should be stripped",
    };
    const result = AgentDisplaySchema.safeParse(agent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("extraField" in result.data).toBe(false);
    }
  });
});
