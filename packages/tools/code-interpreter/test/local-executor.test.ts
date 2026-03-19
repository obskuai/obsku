import { describe, expect, test } from "bun:test";
import { LocalProcessExecutor } from "../src/local-executor";

const executor = new LocalProcessExecutor();

describe("LocalProcessExecutor - basic execution", () => {
  test("executes javascript and returns stdout", async () => {
    const result = await executor.execute({
      code: `console.log("hello from js")`,
      language: "javascript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("hello from js");
    expect(result.exitCode).toBe(0);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  test("captures stderr", async () => {
    const result = await executor.execute({
      code: `process.stderr.write("err output\n")`,
      language: "javascript",
    });
    expect(result.stderr).toContain("err output");
  });

  test("reports failure on non-zero exit", async () => {
    const result = await executor.execute({
      code: `process.exit(1)`,
      language: "javascript",
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test("returns undefined outputFiles when none produced", async () => {
    const result = await executor.execute({
      code: `console.log("no files")`,
      language: "javascript",
    });
    expect(result.outputFiles).toBeUndefined();
  });
});

describe("LocalProcessExecutor - input file staging", () => {
  test("staged string input file is readable by code", async () => {
    const result = await executor.execute({
      code: `
        const fs = require("fs");
        const data = fs.readFileSync("input.txt", "utf-8");
        console.log(data.trim());
      `,
      inputFiles: new Map([["input.txt", "staged content"]]),
      language: "javascript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("staged content");
  });

  test("staged Uint8Array input file is readable by code", async () => {
    const bytes = new TextEncoder().encode("binary staged");
    const result = await executor.execute({
      code: `
        const fs = require("fs");
        const data = fs.readFileSync("data.bin", "utf-8");
        console.log(data.trim());
      `,
      inputFiles: new Map([["data.bin", bytes]]),
      language: "javascript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("binary staged");
  });

  test("multiple input files all staged", async () => {
    const result = await executor.execute({
      code: `
        const fs = require("fs");
        const a = fs.readFileSync("a.txt", "utf-8").trim();
        const b = fs.readFileSync("b.txt", "utf-8").trim();
        console.log(a + "," + b);
      `,
      inputFiles: new Map([
        ["a.txt", "alpha"],
        ["b.txt", "beta"],
      ]),
      language: "javascript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("alpha,beta");
  });

  test("input files excluded from outputFiles", async () => {
    const result = await executor.execute({
      code: `console.log("done")`,
      inputFiles: new Map([["input.txt", "hello"]]),
      language: "javascript",
    });
    expect(result.outputFiles?.has("input.txt")).toBeFalsy();
  });
});

describe("LocalProcessExecutor - output file detection", () => {
  test("output files written by code are collected", async () => {
    const result = await executor.execute({
      code: `
        const fs = require("fs");
        fs.writeFileSync("output.txt", "result data");
      `,
      language: "javascript",
    });
    expect(result.success).toBe(true);
    expect(result.outputFiles).toBeDefined();
    expect(result.outputFiles!.has("output.txt")).toBe(true);
    const content = new TextDecoder().decode(result.outputFiles!.get("output.txt"));
    expect(content).toBe("result data");
  });

  test("multiple output files collected", async () => {
    const result = await executor.execute({
      code: `
        const fs = require("fs");
        fs.writeFileSync("out1.txt", "first");
        fs.writeFileSync("out2.txt", "second");
      `,
      language: "javascript",
    });
    expect(result.outputFiles?.size).toBe(2);
    expect(result.outputFiles!.has("out1.txt")).toBe(true);
    expect(result.outputFiles!.has("out2.txt")).toBe(true);
  });

  test("code file itself excluded from outputs", async () => {
    const result = await executor.execute({
      code: `console.log("x")`,
      language: "javascript",
    });
    expect(result.outputFiles?.has("__code__.js")).toBeFalsy();
  });

  test("output files returned as Uint8Array", async () => {
    const result = await executor.execute({
      code: `
        const fs = require("fs");
        fs.writeFileSync("out.txt", "data");
      `,
      language: "javascript",
    });
    const content = result.outputFiles?.get("out.txt");
    expect(content).toBeInstanceOf(Uint8Array);
  });
});

describe("LocalProcessExecutor - binary file roundtrip", () => {
  test("binary input file preserved byte-for-byte", async () => {
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await executor.execute({
      code: `
        const fs = require("fs");
        const data = fs.readFileSync("img.png");
        fs.writeFileSync("out.bin", data);
      `,
      inputFiles: new Map([["img.png", pngSignature]]),
      language: "javascript",
    });
    expect(result.success).toBe(true);
    const output = result.outputFiles?.get("out.bin");
    expect(output).toBeInstanceOf(Uint8Array);
    expect(output).toEqual(pngSignature);
  });

  test("binary output preserves all byte values 0-255", async () => {
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      allBytes[i] = i;
    }

    const result = await executor.execute({
      code: `
        const fs = require("fs");
        const input = fs.readFileSync("all_bytes.bin");
        fs.writeFileSync("roundtrip.bin", input);
      `,
      inputFiles: new Map([["all_bytes.bin", allBytes]]),
      language: "javascript",
    });
    expect(result.success).toBe(true);
    const output = result.outputFiles?.get("roundtrip.bin");
    expect(output).toEqual(allBytes);
  });
});

describe("LocalProcessExecutor - size limits", () => {
  test("rejects input file exceeding 10MB", async () => {
    const bigFile = new Uint8Array(10 * 1024 * 1024 + 1);
    await expect(
      executor.execute({
        code: `console.log("hi")`,
        inputFiles: new Map([["big.bin", bigFile]]),
        language: "javascript",
      })
    ).rejects.toThrow("10MB");
  });

  test("accepts input file exactly at 10MB limit", async () => {
    const exactLimit = new Uint8Array(10 * 1024 * 1024);
    const result = await executor.execute({
      code: `
        const fs = require("fs");
        const data = fs.readFileSync("exact.bin");
        console.log(data.length);
      `,
      inputFiles: new Map([["exact.bin", exactLimit]]),
      language: "javascript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe(String(10 * 1024 * 1024));
  });

  test("total output exceeding 50MB throws", async () => {
    await expect(
      executor.execute({
        code: `
          const fs = require("fs");
          const chunk = Buffer.alloc(26 * 1024 * 1024, 0x41);
          fs.writeFileSync("a.bin", chunk);
          fs.writeFileSync("b.bin", chunk);
        `,
        language: "javascript",
      })
    ).rejects.toThrow("50MB");
  });
});

describe("LocalProcessExecutor - timeout", () => {
  test("times out long-running code", async () => {
    const result = await executor.execute({
      code: `
        const start = Date.now();
        while (Date.now() - start < 10000) {}
      `,
      language: "javascript",
      timeoutMs: 200,
    });
    expect(result.isTimeout).toBe(true);
    expect(result.success).toBe(false);
  });
});

describe("LocalProcessExecutor - lifecycle", () => {
  test("initialize resolves without error", async () => {
    const e = new LocalProcessExecutor();
    await expect(e.initialize()).resolves.toBeUndefined();
  });

  test("dispose resolves without error", async () => {
    const e = new LocalProcessExecutor();
    await expect(e.dispose()).resolves.toBeUndefined();
  });

  test("name is local-process", () => {
    expect(executor.name).toBe("local-process");
  });

  test("supportedLanguages includes all three", () => {
    expect(executor.supportedLanguages).toContain("python");
    expect(executor.supportedLanguages).toContain("javascript");
    expect(executor.supportedLanguages).toContain("typescript");
  });
});
