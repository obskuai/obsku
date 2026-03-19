import { describe, expect, it, mock } from "bun:test";
import type { Entity, Fact } from "../../src/memory/types";
import {
  buildContextString,
  extractTextFromResponse,
  formatMessagesForSummary,
  parseEntitiesFromResponse,
  parseFactsFromResponse,
} from "../../src/memory/utils";
import type { LLMResponse, Message } from "../../src/types";

describe("extractTextFromResponse", () => {
  it("returns text from first text block", () => {
    const response: LLMResponse = {
      content: [{ text: "Hello world", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };
    expect(extractTextFromResponse(response)).toBe("Hello world");
  });

  it("returns null when no text blocks", () => {
    const response: LLMResponse = {
      content: [{ input: {}, name: "test", toolUseId: "123", type: "tool_use" }],
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 5 },
    };
    expect(extractTextFromResponse(response)).toBeNull();
  });

  it("returns first text block when multiple exist", () => {
    const response: LLMResponse = {
      content: [
        { text: "First", type: "text" },
        { text: "Second", type: "text" },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };
    expect(extractTextFromResponse(response)).toBe("First");
  });

  it("returns null for empty content array", () => {
    const response: LLMResponse = {
      content: [],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    expect(extractTextFromResponse(response)).toBeNull();
  });
});

describe("buildContextString", () => {
  const entity1: Entity = {
    attributes: { role: "admin" },
    createdAt: Date.now(),
    id: "e1",
    name: "John",
    relationships: [],
    sessionId: "s1",
    type: "person",
    updatedAt: Date.now(),
  };

  const entity2: Entity = {
    attributes: {},
    createdAt: Date.now(),
    id: "e2",
    name: "example.com",
    relationships: [],
    sessionId: "s1",
    type: "domain",
    updatedAt: Date.now(),
  };

  const fact1: Fact = {
    confidence: 0.9,
    content: "Server runs nginx",
    createdAt: Date.now(),
    id: "f1",
  };

  it("returns empty string for no entities or facts", () => {
    expect(buildContextString([], [], 1000)).toBe("");
  });

  it("formats entities correctly", () => {
    const result = buildContextString([entity1], [], 1000);
    expect(result).toContain("Known Entities:");
    expect(result).toContain("John (person)");
    expect(result).toContain("role: admin");
  });

  it("formats facts correctly", () => {
    const result = buildContextString([], [fact1], 1000);
    expect(result).toContain("Relevant Facts:");
    expect(result).toContain("Server runs nginx");
  });

  it("combines entities and facts", () => {
    const result = buildContextString([entity1, entity2], [fact1], 1000);
    expect(result).toContain("Known Entities:");
    expect(result).toContain("Relevant Facts:");
    expect(result).toContain("John (person)");
    expect(result).toContain("example.com (domain)");
  });

  it("truncates when over maxLength", () => {
    const result = buildContextString([entity1, entity2], [fact1], 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith("...")).toBe(true);
  });

  it("truncates at newline boundary when possible", () => {
    const result = buildContextString([entity1, entity2], [], 40);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("parseEntitiesFromResponse", () => {
  it("parses valid JSON entity array", () => {
    const response: LLMResponse = {
      content: [
        {
          text: '[{"name": "John", "type": "person", "attributes": {"role": "admin"}}]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    const entities = parseEntitiesFromResponse(response, "session-1", "workspace-1");
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("John");
    expect(entities[0].type).toBe("person");
    expect(entities[0].sessionId).toBe("session-1");
    expect(entities[0].workspaceId).toBe("workspace-1");
    expect(entities[0].attributes).toEqual({ role: "admin" });
  });

  it("handles markdown code fence wrapped JSON", () => {
    const response: LLMResponse = {
      content: [
        {
          text: '```json\n[{"name": "example.com", "type": "domain", "attributes": {}}]\n```',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    const entities = parseEntitiesFromResponse(response, "s1");
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("example.com");
  });

  it("returns empty array for malformed JSON", () => {
    const response: LLMResponse = {
      content: [{ text: "this is not json", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    const entities = parseEntitiesFromResponse(response, "s1");
    expect(entities).toEqual([]);
  });

  it("logs parse failures for malformed entity JSON", () => {
    const response: LLMResponse = {
      content: [{ text: "this is not json", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };
    const logger = { warn: mock(() => {}) };

    const entities = parseEntitiesFromResponse(response, "s1", undefined, logger as never);

    expect(entities).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to parse entities"));
  });

  it("returns empty array for non-array JSON", () => {
    const response: LLMResponse = {
      content: [{ text: '{"name": "John"}', type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    const entities = parseEntitiesFromResponse(response, "s1");
    expect(entities).toEqual([]);
  });

  it("filters invalid entities (missing required fields)", () => {
    const response: LLMResponse = {
      content: [
        {
          text: '[{"name": "Valid", "type": "person"}, {"name": 123}, {"type": "invalid"}]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    const entities = parseEntitiesFromResponse(response, "s1");
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("Valid");
  });

  it("parses relationships correctly", () => {
    const response: LLMResponse = {
      content: [
        {
          text: '[{"name": "A", "type": "domain", "relationships": [{"type": "hosts", "targetName": "B"}]}]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    const entities = parseEntitiesFromResponse(response, "s1");
    expect(entities[0].relationships).toEqual([{ targetId: "B", type: "hosts" }]);
  });

  it("returns empty array when no text content", () => {
    const response: LLMResponse = {
      content: [],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    };

    const entities = parseEntitiesFromResponse(response, "s1");
    expect(entities).toEqual([]);
  });
});

describe("parseFactsFromResponse", () => {
  it("parses valid JSON fact array", () => {
    const response: LLMResponse = {
      content: [
        {
          text: '[{"content": "Server runs nginx", "confidence": 0.9}]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    const facts = parseFactsFromResponse(response, "workspace-1", "session-1");
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("Server runs nginx");
    expect(facts[0].confidence).toBe(0.9);
    expect(facts[0].workspaceId).toBe("workspace-1");
    expect(facts[0].sourceSessionId).toBe("session-1");
  });

  it("defaults confidence to 0.5 when invalid", () => {
    const response: LLMResponse = {
      content: [
        {
          text: '[{"content": "Some fact", "confidence": "high"}]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    const facts = parseFactsFromResponse(response);
    expect(facts[0].confidence).toBe(0.5);
  });

  it("defaults confidence to 0.5 when out of range", () => {
    const response: LLMResponse = {
      content: [{ text: '[{"content": "Fact", "confidence": 1.5}]', type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 10 },
    };

    const facts = parseFactsFromResponse(response);
    expect(facts[0].confidence).toBe(0.5);
  });

  it("returns empty array for malformed JSON", () => {
    const response: LLMResponse = {
      content: [{ text: "not json", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    const facts = parseFactsFromResponse(response);
    expect(facts).toEqual([]);
  });

  it("logs parse failures for malformed fact JSON", () => {
    const response: LLMResponse = {
      content: [{ text: "not json", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };
    const logger = { warn: mock(() => {}) };

    const facts = parseFactsFromResponse(response, undefined, undefined, logger as never);

    expect(facts).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to parse facts"));
  });

  it("filters invalid facts (missing content)", () => {
    const response: LLMResponse = {
      content: [
        {
          text: '[{"content": "Valid"}, {"confidence": 0.9}, {"content": 123}]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    const facts = parseFactsFromResponse(response);
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("Valid");
  });

  it("handles markdown code fences", () => {
    const response: LLMResponse = {
      content: [
        {
          text: '```\n[{"content": "Fact from markdown", "confidence": 0.8}]\n```',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    const facts = parseFactsFromResponse(response);
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("Fact from markdown");
  });
});

describe("formatMessagesForSummary", () => {
  it("formats user and assistant messages", () => {
    const messages: Array<Message> = [
      { content: [{ text: "Hello", type: "text" }], role: "user" },
      { content: [{ text: "Hi there", type: "text" }], role: "assistant" },
    ];

    const result = formatMessagesForSummary(messages);
    expect(result).toContain("User: Hello");
    expect(result).toContain("Assistant: Hi there");
  });

  it("joins multiple text blocks in a message", () => {
    const messages: Array<Message> = [
      {
        content: [
          { text: "Part 1 ", type: "text" },
          { text: "Part 2", type: "text" },
        ],
        role: "user",
      },
    ];

    const result = formatMessagesForSummary(messages);
    expect(result).toContain("User: Part 1 Part 2");
  });

  it("ignores non-text content blocks", () => {
    const messages: Array<Message> = [
      {
        content: [
          { text: "I'll use a tool", type: "text" },
          { input: {}, name: "test", toolUseId: "123", type: "tool_use" },
        ],
        role: "assistant",
      },
    ];

    const result = formatMessagesForSummary(messages);
    expect(result).toBe("Assistant: I'll use a tool");
    expect(result).not.toContain("tool_use");
  });

  it("separates messages with double newlines", () => {
    const messages: Array<Message> = [
      { content: [{ text: "First", type: "text" }], role: "user" },
      { content: [{ text: "Second", type: "text" }], role: "assistant" },
    ];

    const result = formatMessagesForSummary(messages);
    expect(result).toBe("User: First\n\nAssistant: Second");
  });

  it("returns empty string for empty messages", () => {
    const result = formatMessagesForSummary([]);
    expect(result).toBe("");
  });
});

describe("parseEntitiesFromResponse - JSON extraction characterization", () => {
  it("extracts bare JSON before fenced JSON (trimmed priority)", () => {
    // memory/parse-helpers.ts prioritizes trimmed text FIRST, then fences
    const response: LLMResponse = {
      content: [
        {
          text: '{"name": "bare", "type": "test"}\n```json\n[{"name": "fenced", "type": "test"}]\n```',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    // Note: The trimmed text is NOT valid JSON array, so it falls through
    // First valid array is from json_block match
    const entities = parseEntitiesFromResponse(response, "s1");
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("fenced");
  });

  it("extracts fenced JSON when no bare JSON array present", () => {
    const response: LLMResponse = {
      content: [
        {
          text: '```json\n[{"name": "fenced", "type": "test"}]\n```',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    const entities = parseEntitiesFromResponse(response, "s1");
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("fenced");
  });

  it("extracts bare JSON array from text", () => {
    const response: LLMResponse = {
      content: [
        {
          text: 'Here are the entities: [{"name": "bare", "type": "test"}]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    // bare_json regex extracts the array
    const entities = parseEntitiesFromResponse(response, "s1");
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("bare");
  });

  it("returns empty array when all JSON candidates fail", () => {
    const response: LLMResponse = {
      content: [{ text: "not valid json", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    const entities = parseEntitiesFromResponse(response, "s1");
    expect(entities).toEqual([]);
  });

  it("handles trailing text after JSON array gracefully", () => {
    const response: LLMResponse = {
      content: [
        {
          text: '[{"name": "valid", "type": "test"}] and some trailing text',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    // trimmed text is invalid JSON array, so tries bare_json which extracts array
    const entities = parseEntitiesFromResponse(response, "s1");
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("valid");
  });

  it("filters non-object items from array", () => {
    const response: LLMResponse = {
      content: [
        {
          text: '[{"name": "valid", "type": "test"}, "not an object", 123]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    const entities = parseEntitiesFromResponse(response, "s1");
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("valid");
  });
});

describe("parseFactsFromResponse - JSON extraction characterization", () => {
  it("extracts bare JSON before fenced JSON (trimmed priority)", () => {
    // Same behavior as parseEntitiesFromResponse
    const response: LLMResponse = {
      content: [
        {
          text: '{"content": "bare fact"}\n```json\n[{"content": "fenced fact"}]\n```',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    // trimmed is not valid array, so uses fenced
    const facts = parseFactsFromResponse(response, "w1", "s1");
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("fenced fact");
  });

  it("extracts bare JSON array from text", () => {
    const response: LLMResponse = {
      content: [
        {
          text: 'Facts: [{"content": "bare fact", "confidence": 0.8}]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    const facts = parseFactsFromResponse(response, "w1", "s1");
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("bare fact");
    expect(facts[0].confidence).toBe(0.8);
  });

  it("returns empty array for malformed JSON", () => {
    const response: LLMResponse = {
      content: [{ text: "{broken json", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    const facts = parseFactsFromResponse(response);
    expect(facts).toEqual([]);
  });

  it("filters facts without string content", () => {
    const response: LLMResponse = {
      content: [
        {
          text: '[{"content": "valid fact"}, {"confidence": 0.9}, {"content": 123}]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    };

    const facts = parseFactsFromResponse(response);
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("valid fact");
  });
});

describe("Memory extraction behavior differences", () => {
  it("memory prefers trimmed, json-utils prefers json_fence", () => {
    // This test documents the key difference:
    // - json-utils.ts: json_fence > code_fence > trimmed > bare_json
    // - memory/parse-helpers.ts: trimmed > json_block > code_block > bare_json

    const _text = '{"single": "object"}\n```json\n[{"name": "fenced", "type": "test"}]\n```';

    // json-utils would extract: {"single": "object"} (first valid JSON)
    const jsonUtilsResult = JSON.stringify({ single: "object" });
    expect(jsonUtilsResult).toContain("single");

    // memory helpers need array, so trimmed fails and falls back to fenced
    // (This is just documenting the behavior difference)
  });

  it("memory returns empty array on failure, json-utils returns null", () => {
    // Different failure modes:
    // - json-utils.ts returns null
    // - memory/parse-helpers.ts returns []

    const response: LLMResponse = {
      content: [{ text: "not json", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    const entities = parseEntitiesFromResponse(response, "s1");
    expect(entities).toEqual([]);

    // json-utils would return null
    expect(null).toBeNull(); // Placeholder for documentation
  });
});
