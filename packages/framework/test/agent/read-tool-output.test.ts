import { describe, expect, it } from "bun:test";
import { createReadToolOutputPlugin } from "../../src/agent/read-tool-output";
import { setupPlugins } from "../../src/agent/setup";
import { InMemoryBlobStore } from "../../src/blob/in-memory";
import { convertZodToParamDef, plugin } from "../../src/plugin";

describe("read_tool_output", () => {
  it("returns full output from BlobStore for valid ref", async () => {
    const blobStore = new InMemoryBlobStore();
    const fullOutput = "This is the full tool output that was truncated.";
    const ref = await blobStore.put("tool-output-0", fullOutput);

    const pluginDef = createReadToolOutputPlugin(blobStore);
    const internal = plugin(pluginDef);
    const result = await runPlugin(internal, { ref });

    expect(result).toBe(fullOutput);
  });

  it("returns clear error message for invalid ref", async () => {
    const blobStore = new InMemoryBlobStore();
    const pluginDef = createReadToolOutputPlugin(blobStore);
    const internal = plugin(pluginDef);
    const result = await runPlugin(internal, { ref: "nonexistent-key" });

    expect(result).toContain("Tool output ref not found: nonexistent-key");
  });

  it("has correct plugin definition shape", () => {
    const blobStore = new InMemoryBlobStore();
    const pluginDef = createReadToolOutputPlugin(blobStore);
    const paramDef = convertZodToParamDef(pluginDef.params);

    expect(pluginDef.name).toBe("read_tool_output");
    expect(pluginDef.description).toContain("truncated");
    expect(paramDef.ref.type).toBe("string");
    // Required params don't have 'required' field set (undefined = required by default)
    expect(paramDef.ref.required).toBeUndefined();
    expect(paramDef.offset.type).toBe("number");
    expect(paramDef.limit.type).toBe("number");
  });

  it("supports offset/limit pagination", async () => {
    const blobStore = new InMemoryBlobStore();
    const fullOutput = "A".repeat(1000);
    const ref = await blobStore.put("tool-output-1", fullOutput);

    const pluginDef = createReadToolOutputPlugin(blobStore);
    const internal = plugin(pluginDef);
    const result = await runPlugin(internal, { limit: 500, offset: 100, ref });

    expect(result).toBe("A".repeat(500));
  });

  it("returns empty string when offset beyond content length", async () => {
    const blobStore = new InMemoryBlobStore();
    const fullOutput = "Short content";
    const ref = await blobStore.put("tool-output-2", fullOutput);

    const pluginDef = createReadToolOutputPlugin(blobStore);
    const internal = plugin(pluginDef);
    const result = await runPlugin(internal, { offset: 9999, ref });

    expect(result).toBe("");
  });

  it("uses default offset=0 and limit=10000", async () => {
    const blobStore = new InMemoryBlobStore();
    const fullOutput = "B".repeat(20_000);
    const ref = await blobStore.put("tool-output-3", fullOutput);

    const pluginDef = createReadToolOutputPlugin(blobStore);
    const internal = plugin(pluginDef);
    const result = await runPlugin(internal, { ref });

    expect(result).toBe("B".repeat(10_000));
  });

  it("returns remaining content when limit exceeds remaining", async () => {
    const blobStore = new InMemoryBlobStore();
    const fullOutput = "C".repeat(200);
    const ref = await blobStore.put("tool-output-4", fullOutput);

    const pluginDef = createReadToolOutputPlugin(blobStore);
    const internal = plugin(pluginDef);
    const result = await runPlugin(internal, { limit: 500, offset: 150, ref });

    expect(result).toBe("C".repeat(50));
  });
});

describe("read_tool_output injection", () => {
  it("tool NOT in toolDefs when blobStore not configured", () => {
    const { toolDefs } = setupPlugins({ name: "test", prompt: "test" });
    expect(toolDefs.find((t) => t.name === "read_tool_output")).toBeUndefined();
  });

  it("tool IS in toolDefs when blobStore configured", () => {
    const blobStore = new InMemoryBlobStore();
    const { resolvedTools, toolDefs } = setupPlugins({
      name: "test",
      prompt: "test",
      truncation: { blobStore },
    });
    expect(toolDefs.find((t) => t.name === "read_tool_output")).toBeDefined();
    expect(resolvedTools.has("read_tool_output")).toBe(true);
  });
});

async function runPlugin(
  internal: ReturnType<typeof plugin>,
  input: Record<string, unknown>
): Promise<string> {
  const { Effect } = await import("effect");
  const result = (await Effect.runPromise(Effect.scoped(internal.execute(input)))) as {
    result: string;
  };
  return result.result;
}
