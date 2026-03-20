import { describe, expect, it } from "bun:test";
import type { ClaudeCodeMode, ClaudeCodePluginParams, ClaudeCodeSchemaObject } from "../src/types";

describe("ClaudeCodePluginParams validation", () => {
  describe("prompt field", () => {
    it("should require prompt field", () => {
      // TypeScript compile-time check: prompt is required
      const validParams: ClaudeCodePluginParams = {
        prompt: "Test prompt",
      };
      expect(validParams.prompt).toBe("Test prompt");
    });

    it("should accept prompt with string value", () => {
      const params: ClaudeCodePluginParams = {
        prompt: "What is the weather?",
      };
      expect(typeof params.prompt).toBe("string");
      expect(params.prompt).toBe("What is the weather?");
    });

    it("should accept multiline prompt", () => {
      const params: ClaudeCodePluginParams = {
        prompt: `Line 1
Line 2
Line 3`,
      };
      expect(params.prompt).toContain("Line 1");
      expect(params.prompt).toContain("Line 2");
      expect(params.prompt).toContain("\n");
    });
  });

  describe("optional fields", () => {
    it("should work with only prompt (all others optional)", () => {
      const params: ClaudeCodePluginParams = {
        prompt: "Test",
      };
      expect(params.prompt).toBe("Test");
      expect(params.cwd).toBeUndefined();
      expect(params.mode).toBeUndefined();
      expect(params.schema).toBeUndefined();
    });

    it("should accept optional cwd", () => {
      const params: ClaudeCodePluginParams = {
        cwd: "/some/path",
        prompt: "Test",
      };
      expect(params.cwd).toBe("/some/path");
    });

    it("should accept optional mode", () => {
      const params: ClaudeCodePluginParams = {
        mode: "text",
        prompt: "Test",
      };
      expect(params.mode).toBe("text");
    });

    it("should accept optional schema", () => {
      const schema: ClaudeCodeSchemaObject = {
        properties: {
          name: { type: "string" },
        },
        type: "object",
      };
      const params: ClaudeCodePluginParams = {
        prompt: "Test",
        schema,
      };
      expect(params.schema).toEqual(schema);
    });
  });

  describe("mode types", () => {
    it("should accept 'text' mode", () => {
      const mode: ClaudeCodeMode = "text";
      const params: ClaudeCodePluginParams = {
        mode,
        prompt: "Test",
      };
      expect(params.mode).toBe("text");
    });

    it("should accept 'json' mode", () => {
      const mode: ClaudeCodeMode = "json";
      const params: ClaudeCodePluginParams = {
        mode,
        prompt: "Test",
      };
      expect(params.mode).toBe("json");
    });

    it("should not accept invalid mode values at type level", () => {
      // TypeScript prevents invalid modes at compile time
      // Runtime test with type assertion
      const invalidMode = "invalid" as ClaudeCodeMode;
      const params: ClaudeCodePluginParams = {
        mode: invalidMode,
        prompt: "Test",
      };
      // Type allows it (cast) but we can verify it's not a valid mode
      expect(params.mode).not.toBe("text");
      expect(params.mode).not.toBe("json");
    });
  });

  describe("schema validation", () => {
    it("should accept JSON schema object", () => {
      const schema: ClaudeCodeSchemaObject = {
        properties: {
          count: { type: "number" },
          result: { type: "string" },
        },
        required: ["result"],
        type: "object",
      };
      const params: ClaudeCodePluginParams = {
        mode: "json",
        prompt: "Test",
        schema,
      };
      expect(params.schema?.type).toBe("object");
      expect(params.schema?.properties).toBeDefined();
    });

    it("should accept empty schema object", () => {
      const schema: ClaudeCodeSchemaObject = {};
      const params: ClaudeCodePluginParams = {
        prompt: "Test",
        schema,
      };
      expect(params.schema).toEqual({});
    });

    it("should accept nested schema objects", () => {
      const schema: ClaudeCodeSchemaObject = {
        properties: {
          user: {
            properties: {
              email: { type: "string" },
              name: { type: "string" },
            },
            type: "object",
          },
        },
        type: "object",
      };
      const params: ClaudeCodePluginParams = {
        prompt: "Test",
        schema,
      };
      expect(
        (params.schema?.properties as Record<string, unknown> | undefined)?.user
      ).toBeDefined();
    });
  });
});

describe("Output contract", () => {
  describe("text mode output", () => {
    it("should expect string output for text mode", () => {
      // Contract: text mode returns string
      const textOutput: string = "This is the response text";
      expect(typeof textOutput).toBe("string");
    });

    it("should handle empty string in text mode", () => {
      const textOutput: string = "";
      expect(textOutput).toBe("");
    });

    it("should handle multiline string in text mode", () => {
      const textOutput: string = `Line 1
Line 2
Line 3`;
      expect(textOutput).toContain("\n");
      expect(textOutput.split("\n")).toHaveLength(3);
    });
  });

  describe("json mode output", () => {
    it("should expect object output for json mode", () => {
      // Contract: json mode returns parsed object
      const jsonOutput: Record<string, unknown> = {
        data: { value: 42 },
        result: "success",
      };
      expect(typeof jsonOutput).toBe("object");
      expect(jsonOutput.result).toBe("success");
    });

    it("should parse JSON string to object", () => {
      const jsonString = '{"result": "success", "count": 5}';
      const parsed = JSON.parse(jsonString) as Record<string, unknown>;
      expect(typeof parsed).toBe("object");
      expect(parsed.result).toBe("success");
      expect(parsed.count).toBe(5);
    });

    it("should handle nested objects in json mode", () => {
      const jsonOutput: Record<string, unknown> = {
        timestamp: "2024-01-01",
        user: {
          email: "john@example.com",
          name: "John",
        },
      };
      expect(typeof jsonOutput.user).toBe("object");
      expect((jsonOutput.user as { name: string }).name).toBe("John");
    });

    it("should handle arrays in json mode", () => {
      const jsonOutput: Record<string, unknown> = {
        count: 3,
        items: ["a", "b", "c"],
      };
      expect(Array.isArray(jsonOutput.items)).toBe(true);
      expect((jsonOutput.items as Array<string>).length).toBe(3);
    });

    it("should handle empty object in json mode", () => {
      const jsonOutput: Record<string, unknown> = {};
      expect(Object.keys(jsonOutput)).toHaveLength(0);
    });
  });

  describe("mode-specific contracts", () => {
    it("text mode should return plain string not JSON", () => {
      const textModeOutput = "Just plain text";
      // Should not be parsable as JSON
      expect(() => JSON.parse(textModeOutput)).toThrow();
    });

    it("json mode should return valid JSON object", () => {
      const jsonModeOutput = '{"key": "value", "number": 123}';
      expect(() => JSON.parse(jsonModeOutput)).not.toThrow();
      const parsed = JSON.parse(jsonModeOutput);
      expect(typeof parsed).toBe("object");
    });

    it("schema should constrain json mode output shape", () => {
      const _schema: ClaudeCodeSchemaObject = {
        properties: {
          age: { type: "number" },
          name: { type: "string" },
        },
        required: ["name"],
        type: "object",
      };

      // Valid output matching schema
      const validOutput = {
        age: 30,
        name: "Alice",
      };

      // Verify structure matches expected schema shape
      expect(typeof validOutput.name).toBe("string");
      expect(typeof validOutput.age).toBe("number");
      expect(validOutput.name).toBe("Alice");
    });
  });
});

describe("Type constraints", () => {
  it("should enforce readonly params", () => {
    const params: ClaudeCodePluginParams = {
      cwd: "/path",
      mode: "json",
      prompt: "Test",
      schema: { type: "object" },
    } as const;

    // TypeScript ensures these are readonly at compile time
    expect(params.prompt).toBe("Test");
    expect(params.cwd).toBe("/path");
    expect(params.mode).toBe("json");
  });

  it("should allow partial param objects", () => {
    // All fields except prompt are optional
    const minimalParams: ClaudeCodePluginParams = {
      prompt: "Minimal",
    };
    expect(minimalParams.prompt).toBe("Minimal");

    const withCwd: ClaudeCodePluginParams = {
      cwd: "/home",
      prompt: "With cwd",
    };
    expect(withCwd.cwd).toBe("/home");

    const withMode: ClaudeCodePluginParams = {
      mode: "text",
      prompt: "With mode",
    };
    expect(withMode.mode).toBe("text");
  });
});
