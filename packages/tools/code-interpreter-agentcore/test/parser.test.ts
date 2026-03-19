import { describe, expect, test } from "bun:test";
import type { CodeInterpreterStreamOutput } from "@aws-sdk/client-bedrock-agentcore";
import {
  collectStructuredContent,
  extractStructuredContent,
  mergeStructuredContent,
} from "../src/parser";

function asOutput(value: unknown): CodeInterpreterStreamOutput {
  return value as CodeInterpreterStreamOutput;
}

async function* streamOf(...items: Array<unknown>): AsyncIterable<CodeInterpreterStreamOutput> {
  for (const item of items) {
    yield asOutput(item);
  }
}

describe("parser extractStructuredContent", () => {
  test("accepts event.result.structuredContent payloads", () => {
    const payload = asOutput({
      event: {
        result: {
          structuredContent: { exitCode: 0, stdout: "from event" },
        },
      },
    });

    expect(extractStructuredContent(payload)).toEqual({ exitCode: 0, stdout: "from event" });
  });

  test("accepts direct result.structuredContent payloads", () => {
    const payload = asOutput({
      result: {
        structuredContent: { executionTime: 12, stderr: "", stdout: "from direct" },
      },
    });

    expect(extractStructuredContent(payload)).toEqual({
      executionTime: 12,
      stderr: "",
      stdout: "from direct",
    });
  });

  test("accepts new result.content list payloads", () => {
    const payload = asOutput({
      result: {
        content: [{ text: "report", type: "text" }],
        fileNames: ["report.txt"],
        stdout: "listed",
      },
    });

    expect(extractStructuredContent(payload)).toEqual({
      content: [{ text: "report", type: "text" }],
      fileNames: ["report.txt"],
      stdout: "listed",
    });
  });

  test("accepts content-list items even when nested fields are missing", () => {
    const payload = asOutput({
      result: {
        content: [{}, { name: "out.txt" }],
        fileNames: ["out.txt"],
      },
    });

    expect(extractStructuredContent(payload)).toEqual({
      content: [{}, { name: "out.txt" }],
      fileNames: ["out.txt"],
    });
  });

  test("returns undefined for malformed objects and missing nested wrappers", () => {
    const cases = [
      {},
      { event: {} },
      { event: { result: null } },
      { event: { result: {} } },
      { result: null },
      { result: {} },
      { result: { content: "nope" } },
    ];

    for (const value of cases) {
      expect(extractStructuredContent(asOutput(value))).toBeUndefined();
    }
  });

  test("returns undefined for null top-level payloads", () => {
    expect(extractStructuredContent(asOutput(null))).toBeUndefined();
  });

  test("returns undefined when content-list items are malformed but nested wrapper exists", () => {
    expect(extractStructuredContent(asOutput({ result: { content: [null] } }))).toBeUndefined();
  });

  test("returns undefined when structuredContent has invalid field types", () => {
    expect(
      extractStructuredContent(
        asOutput({
          result: {
            structuredContent: { exitCode: "0", stdout: "bad" },
          },
        })
      )
    ).toBeUndefined();
  });
});

describe("parser merge behavior", () => {
  test("mergeStructuredContent dedupes streaming text and keeps newest scalar fields", () => {
    const merged = mergeStructuredContent(
      { exitCode: 1, stderr: "warning text", stdout: "pri" },
      { executionTime: 25, fileNames: ["out.txt"], stderr: "warning", stdout: "print" }
    );

    expect(merged).toEqual({
      executionTime: 25,
      exitCode: 1,
      fileNames: ["out.txt"],
      stderr: "warning text",
      stdout: "print",
    });
  });

  test("collectStructuredContent ignores malformed items and merges valid stream payloads", async () => {
    const collected = await collectStructuredContent(
      streamOf(
        { ignored: true },
        { result: { structuredContent: { exitCode: 1, stderr: "warning text", stdout: "pri" } } },
        {
          event: {
            result: {
              structuredContent: { executionTime: 25, stderr: "warning", stdout: "print" },
            },
          },
        },
        { result: { content: [{}], fileNames: ["out.txt"] } }
      )
    );

    expect(collected).toEqual({
      content: [{}],
      executionTime: 25,
      exitCode: 1,
      fileNames: ["out.txt"],
      stderr: "warning text",
      stdout: "print",
    });
  });

  test("collectStructuredContent returns undefined for absent or fully malformed streams", () => {
    return Promise.all([
      expect(collectStructuredContent()).resolves.toBeUndefined(),
      expect(
        collectStructuredContent(streamOf({ result: { content: [null] } }, { event: {} }, {}))
      ).resolves.toBeUndefined(),
    ]);
  });

  test("collectStructuredContent skips null stream items deterministically", () => {
    return expect(collectStructuredContent(streamOf(null))).resolves.toBeUndefined();
  });
});
