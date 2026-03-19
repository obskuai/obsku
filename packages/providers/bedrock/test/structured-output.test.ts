import { describe, expect, test } from "bun:test";
import type { Message, ResponseFormat, ToolDef } from "@obsku/framework";
import { buildCommandConfig } from "../src/index";

describe("buildCommandConfig() with responseFormat", () => {
  const baseMessages: Array<Message> = [
    { content: [{ text: "test", type: "text" }], role: "user" },
  ];

  const simpleResponseFormat: ResponseFormat = {
    jsonSchema: {
      description: "A test schema",
      name: "test_schema",
      schema: {
        properties: {
          answer: { type: "string" },
        },
        type: "object",
      },
    },
    type: "json_schema",
  };

  test("without responseFormat → no outputConfig", () => {
    const config = buildCommandConfig("model-id", 4096, baseMessages);
    expect(config.outputConfig).toBeUndefined();
  });

  test("with responseFormat → includes outputConfig.textFormat with json_schema", () => {
    const config = buildCommandConfig(
      "model-id",
      4096,
      baseMessages,
      undefined,
      undefined,
      simpleResponseFormat
    );

    expect(config.outputConfig).toBeDefined();
    expect(config.outputConfig?.textFormat?.type).toBe("json_schema");
    expect(config.outputConfig?.textFormat?.structure).toBeDefined();
    expect(config.outputConfig?.textFormat?.structure?.jsonSchema).toBeDefined();
  });

  test("responseFormat schema is JSON.stringify'd in outputConfig", () => {
    const schema = { properties: { answer: { type: "string" } }, type: "object" };
    const responseFormat: ResponseFormat = {
      jsonSchema: {
        name: "test",
        schema,
      },
      type: "json_schema",
    };

    const config = buildCommandConfig(
      "model-id",
      4096,
      baseMessages,
      undefined,
      undefined,
      responseFormat
    );

    const jsonSchema = config.outputConfig?.textFormat?.structure?.jsonSchema;
    expect(jsonSchema?.schema).toBe(JSON.stringify(schema));
  });

  test("responseFormat name and description are preserved", () => {
    const responseFormat: ResponseFormat = {
      jsonSchema: {
        description: "My description",
        name: "my_schema",
        schema: { type: "object" },
      },
      type: "json_schema",
    };

    const config = buildCommandConfig(
      "model-id",
      4096,
      baseMessages,
      undefined,
      undefined,
      responseFormat
    );

    const jsonSchema = config.outputConfig?.textFormat?.structure?.jsonSchema;
    expect(jsonSchema?.name).toBe("my_schema");
    expect(jsonSchema?.description).toBe("My description");
  });

  test("with tools and responseFormat → still includes outputConfig", () => {
    const tools: Array<ToolDef> = [
      {
        description: "A test tool",
        inputSchema: { properties: {}, type: "object" },
        name: "test_tool",
      },
    ];

    const config = buildCommandConfig(
      "model-id",
      4096,
      baseMessages,
      tools,
      undefined,
      simpleResponseFormat
    );

    expect(config.outputConfig).toBeDefined();
    expect(config.toolConfig).toBeDefined();
  });

  test("responseFormat without name/description → only includes schema", () => {
    const responseFormat: ResponseFormat = {
      jsonSchema: {
        schema: { type: "object" },
      },
      type: "json_schema",
    };

    const config = buildCommandConfig(
      "model-id",
      4096,
      baseMessages,
      undefined,
      undefined,
      responseFormat
    );

    const jsonSchema = config.outputConfig?.textFormat?.structure?.jsonSchema;
    expect(jsonSchema?.schema).toBeDefined();
    expect(jsonSchema?.name).toBeUndefined();
    expect(jsonSchema?.description).toBeUndefined();
  });

  test("buildCommandConfig accepts optional responseFormat as 6th param", () => {
    const responseFormat: ResponseFormat = {
      jsonSchema: {
        name: "test",
        schema: { type: "object" },
      },
      type: "json_schema",
    };

    const config = buildCommandConfig(
      "model-id",
      4096,
      baseMessages,
      undefined,
      undefined,
      responseFormat
    );

    expect(config.outputConfig).toBeDefined();
  });
});
