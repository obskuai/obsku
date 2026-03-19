import { describe, expect, it } from "bun:test";
import z from "zod";
import { plugin } from "../src/plugin";
import type { ParamDef } from "../src/types";

describe("plugin() Zod schema support", () => {
  it("should accept Zod object schema as params", () => {
    const zodSchema = z.object({
      active: z.boolean(),
      age: z.number(),
      name: z.string(),
    });

    const testPlugin = plugin({
      description: "Test plugin with Zod schema",
      name: "test-zod",
      params: zodSchema,
      run: async (input) => {
        return `Hello ${input.name}`;
      },
    });

    expect(testPlugin.name).toBe("test-zod");
    expect(testPlugin.params).toBeDefined();
    expect(typeof testPlugin.params).toBe("object");
  });

  it("should convert Zod schema to ParamDef format", () => {
    const zodSchema = z.object({
      active: z.boolean().default(true),
      age: z.number(),
      name: z.string().describe("User name"),
    });

    const testPlugin = plugin({
      description: "Test Zod to ParamDef conversion",
      name: "test-conversion",
      params: zodSchema,
      run: async (input) => {
        return `Hello ${input.name}`;
      },
    });

    const params = testPlugin.params as Record<string, ParamDef>;
    expect(params.name).toBeDefined();
    expect(params.name.type).toBe("string");
    expect(params.age).toBeDefined();
    expect(params.age.type).toBe("number");
    expect(params.active).toBeDefined();
    expect(params.active.type).toBe("boolean");
  });

  it("should validate params correctly with Zod schema", async () => {
    const zodPlugin = plugin({
      description: "Test validation",
      name: "validate-test",
      params: z.object({
        optional: z.number().optional(),
        required: z.string(),
      }),
      run: async (input) => input,
    });

    const { Effect } = await import("effect");
    const result = (await Effect.runPromise(
      zodPlugin.execute({ optional: 42, required: "test" })
    )) as { result: string };
    expect(result.result).toBeDefined();
  });

  it("should handle missing required params with Zod schema", async () => {
    const zodPlugin = plugin({
      description: "Test required validation",
      name: "validate-required",
      params: z.object({
        required: z.string(),
      }),
      run: async (input) => input,
    });

    const { Effect } = await import("effect");
    expect(Effect.runPromise(zodPlugin.execute({}))).rejects.toThrow();
  });

  it("should handle nested object params from Zod", () => {
    const zodPlugin = plugin({
      description: "Test nested objects",
      name: "nested-test",
      params: z.object({
        config: z.object({
          host: z.string(),
          port: z.number(),
        }),
      }),
      run: async (input) => input,
    });

    expect(zodPlugin.params.config).toBeDefined();
    expect(zodPlugin.params.config?.type).toBe("object");
  });

  it("should handle array params from Zod", () => {
    const zodPlugin = plugin({
      description: "Test arrays",
      name: "array-test",
      params: z.object({
        items: z.array(z.string()),
      }),
      run: async (input) => input,
    });

    expect(zodPlugin.params.items).toBeDefined();
    expect(zodPlugin.params.items?.type).toBe("array");
  });

  it("should work without params (empty object)", () => {
    const zodPlugin = plugin({
      description: "Test no params",
      name: "no-params",
      params: z.object({}),
    });

    expect(zodPlugin.params).toEqual({});
  });
});

describe("plugin() type inference", () => {
  it("Zod params infer into run() input type", async () => {
    const { Effect } = await import("effect");
    const testPlugin = plugin({
      description: "Test type inference",
      name: "test-inference",
      params: z.object({ count: z.number(), name: z.string() }),
      run: async (input) => {
        // input.name should be string, input.count should be number
        return `Hello ${input.name}, count is ${input.count}`;
      },
    });

    // Runtime verification
    const result = (await Effect.runPromise(testPlugin.execute({ count: 42, name: "World" }))) as {
      result: string;
    };
    expect(result.result).toBe("Hello World, count is 42");
  });

  it("optional fields with defaults work correctly", async () => {
    const { Effect } = await import("effect");
    const testPlugin = plugin({
      description: "Test optional fields with defaults",
      name: "test-defaults",
      params: z.object({
        flag: z.boolean().default(true),
        optional: z.number().default(100),
        required: z.string(),
      }),
      run: async (input) => {
        return { flag: input.flag, optional: input.optional, required: input.required };
      },
    });

    // Without optional params - should use defaults
    const result1 = (await Effect.runPromise(testPlugin.execute({ required: "test" }))) as {
      result: string;
    };
    expect(result1.result).toEqual(JSON.stringify({ flag: true, optional: 100, required: "test" }));

    // With explicit values - should override defaults
    const result2 = (await Effect.runPromise(
      testPlugin.execute({
        flag: false,
        optional: 200,
        required: "test",
      })
    )) as { result: string };
    expect(result2.result).toEqual(
      JSON.stringify({ flag: false, optional: 200, required: "test" })
    );
  });

  it("nested z.object schemas infer correctly", async () => {
    const { Effect } = await import("effect");
    const testPlugin = plugin({
      description: "Test nested object inference",
      name: "test-nested",
      params: z.object({
        config: z.object({
          host: z.string(),
          port: z.number(),
        }),
      }),
      run: async (input) => {
        // input.config.host should be string, input.config.port should be number
        return `${input.config.host}:${input.config.port}`;
      },
    });

    const result = (await Effect.runPromise(
      testPlugin.execute({
        config: { host: "example.com", port: 8080 },
      })
    )) as { result: string };
    expect(result.result).toBe("example.com:8080");
  });

  it("z.array params infer correctly", async () => {
    const { Effect } = await import("effect");
    const testPlugin = plugin({
      description: "Test array inference",
      name: "test-array",
      params: z.object({
        items: z.array(z.string()),
        numbers: z.array(z.number()),
      }),
      run: async (input) => {
        // input.items should be string[], input.numbers should be number[]
        return {
          first: input.items[0],
          sum: input.numbers.reduce((a, b) => a + b, 0),
        };
      },
    });

    const result = (await Effect.runPromise(
      testPlugin.execute({
        items: ["a", "b", "c"],
        numbers: [1, 2, 3, 4, 5],
      })
    )) as { result: string };
    expect(result.result).toEqual(JSON.stringify({ first: "a", sum: 15 }));
  });

  it("no-params plugin still works (input is Record<string, unknown>)", async () => {
    const { Effect } = await import("effect");
    const testPlugin = plugin({
      description: "Test no params inference",
      name: "test-no-params",
      params: z.object({}),
      run: async (_input) => {
        // _input should be Record<string, unknown>
        return "success";
      },
    });

    expect(testPlugin.params).toEqual({});
    const result = (await Effect.runPromise(testPlugin.execute({}))) as {
      result: string;
    };
    expect(result.result).toBe("success");
  });

  it("Zod validation runs (rejects invalid input with ZodError)", async () => {
    const { Effect } = await import("effect");

    const testPlugin = plugin({
      description: "Test Zod validation rejects invalid input",
      name: "test-validation",
      params: z.object({
        count: z.number(),
        name: z.string(),
      }),
      run: async (input) => {
        return `Hello ${input.name}, count is ${input.count}`;
      },
    });

    // Valid input should work
    const validResult = (await Effect.runPromise(
      testPlugin.execute({ count: 42, name: "World" })
    )) as { result: string };
    expect(validResult.result).toBe("Hello World, count is 42");

    // Invalid: wrong type for name (number instead of string)
    const typeResult = await Effect.runPromise(
      testPlugin.execute({ count: 42, name: 123 }).pipe(Effect.either)
    );
    expect(typeResult._tag).toBe("Left");

    // Invalid: wrong type for count (string instead of number)
    const countTypeResult = await Effect.runPromise(
      testPlugin.execute({ count: "not-a-number", name: "World" }).pipe(Effect.either)
    );
    expect(countTypeResult._tag).toBe("Left");

    // Invalid: missing required field
    const missingResult = await Effect.runPromise(
      testPlugin.execute({ count: 42 }).pipe(Effect.either)
    );
    expect(missingResult._tag).toBe("Left");
  });
});
