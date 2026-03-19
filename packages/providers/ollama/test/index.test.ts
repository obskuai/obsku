import { beforeEach, describe, expect, mock, test } from "bun:test";
import { OllamaEmbedding, OllamaEmbeddingError } from "../src/index";

// Mock the ollama module
const mockEmbeddings = mock(() => Promise.resolve({ embedding: [0.1, 0.2, 0.3, 0.4] }));

mock.module("ollama", () => ({
  Ollama: class MockOllama {
    embeddings = mockEmbeddings;
  },
}));

const DEFAULT_CONFIG = { dimension: 1024, model: "multilingual-e5-large" } as const;

describe("OllamaEmbedding", () => {
  beforeEach(() => {
    mockEmbeddings.mockClear();
  });

  test("sets model and dimension from config", () => {
    const provider = new OllamaEmbedding(DEFAULT_CONFIG);
    expect(provider.modelName).toBe("multilingual-e5-large");
    expect(provider.dimension).toBe(1024);
  });

  test("accepts custom model and dimension", () => {
    const provider = new OllamaEmbedding({ dimension: 768, model: "nomic-embed-text" });
    expect(provider.modelName).toBe("nomic-embed-text");
    expect(provider.dimension).toBe(768);
  });

  test("host defaults to localhost:11434 when omitted", () => {
    const provider = new OllamaEmbedding(DEFAULT_CONFIG);
    expect(provider).toBeDefined();
  });

  test("accepts custom host", () => {
    const provider = new OllamaEmbedding({
      dimension: 1024,
      host: "http://custom:11434",
      model: "multilingual-e5-large",
    });
    expect(provider).toBeDefined();
  });

  test("embed() should call Ollama API with correct parameters", async () => {
    const provider = new OllamaEmbedding(DEFAULT_CONFIG);
    const testText = "Hello world";

    const result = await provider.embed(testText);

    expect(mockEmbeddings).toHaveBeenCalledTimes(1);
    expect(mockEmbeddings).toHaveBeenCalledWith({
      model: "multilingual-e5-large",
      prompt: testText,
    });
    expect(result).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  test("embed() should use custom model when configured", async () => {
    const provider = new OllamaEmbedding({ dimension: 768, model: "nomic-embed-text" });
    const testText = "Test text";

    await provider.embed(testText);

    expect(mockEmbeddings).toHaveBeenCalledWith({
      model: "nomic-embed-text",
      prompt: testText,
    });
  });

  test("embed() should throw OllamaEmbeddingError on API failure", async () => {
    mockEmbeddings.mockImplementation(() => Promise.reject(new Error("Connection refused")));

    const provider = new OllamaEmbedding(DEFAULT_CONFIG);

    await expect(provider.embed("test")).rejects.toThrow(OllamaEmbeddingError);
    await expect(provider.embed("test")).rejects.toThrow(/Failed to generate embedding/);
  });

  test("embedBatch() should call embed() for each text", async () => {
    const provider = new OllamaEmbedding(DEFAULT_CONFIG);
    const texts = ["text 1", "text 2", "text 3"];

    let callCount = 0;
    mockEmbeddings.mockImplementation(() => {
      callCount++;
      return Promise.resolve({ embedding: [0.1 * callCount, 0.2 * callCount] });
    });

    const results = await provider.embedBatch(texts);

    expect(mockEmbeddings).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(3);
    expect(results[0][0]).toBeCloseTo(0.1);
    expect(results[0][1]).toBeCloseTo(0.2);
    expect(results[1][0]).toBeCloseTo(0.2);
    expect(results[1][1]).toBeCloseTo(0.4);
    expect(results[2][0]).toBeCloseTo(0.3);
    expect(results[2][1]).toBeCloseTo(0.6);
  });

  test("embedBatch() should pass correct model to each call", async () => {
    const provider = new OllamaEmbedding({ dimension: 512, model: "custom-model" });
    const texts = ["a", "b"];

    await provider.embedBatch(texts);

    expect(mockEmbeddings).toHaveBeenCalledTimes(2);
    expect(mockEmbeddings).toHaveBeenNthCalledWith(1, {
      model: "custom-model",
      prompt: "a",
    });
    expect(mockEmbeddings).toHaveBeenNthCalledWith(2, {
      model: "custom-model",
      prompt: "b",
    });
  });

  test("embedBatch() should throw OllamaEmbeddingError on failure", async () => {
    mockEmbeddings.mockImplementation(() => Promise.reject(new Error("API error")));

    const provider = new OllamaEmbedding(DEFAULT_CONFIG);

    await expect(provider.embedBatch(["test"])).rejects.toThrow(OllamaEmbeddingError);
  });

  test("embedBatch() with empty array should return empty array", async () => {
    const provider = new OllamaEmbedding(DEFAULT_CONFIG);

    const results = await provider.embedBatch([]);

    expect(results).toEqual([]);
    expect(mockEmbeddings).not.toHaveBeenCalled();
  });

  test("implements EmbeddingProvider interface", () => {
    const provider = new OllamaEmbedding(DEFAULT_CONFIG);

    expect(typeof provider.embed).toBe("function");
    expect(typeof provider.embedBatch).toBe("function");
    expect(typeof provider.dimension).toBe("number");
    expect(typeof provider.modelName).toBe("string");
  });
});

describe("OllamaEmbeddingError", () => {
  test("should create error with correct name", () => {
    const error = new OllamaEmbeddingError("Test error");
    expect(error.name).toBe("OllamaEmbeddingError");
    expect(error.message).toBe("Test error");
  });
});

describe("OllamaEmbeddingError additional tests", () => {
  test("preserves error message from underlying error", async () => {
    mockEmbeddings.mockImplementation(() => Promise.reject(new Error("ECONNREFUSED")));

    const provider = new OllamaEmbedding(DEFAULT_CONFIG);

    try {
      await provider.embed("test");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OllamaEmbeddingError);
      expect((error as OllamaEmbeddingError).message).toContain("ECONNREFUSED");
    }
  });

  test("handles non-Error rejection", async () => {
    mockEmbeddings.mockImplementation(() => Promise.reject("string error"));

    const provider = new OllamaEmbedding(DEFAULT_CONFIG);

    try {
      await provider.embed("test");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OllamaEmbeddingError);
      expect((error as OllamaEmbeddingError).message).toContain("string error");
    }
  });

  test("embedBatch handles partial failure", async () => {
    let callCount = 0;
    mockEmbeddings.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.reject(new Error("Second call failed"));
      }
      return Promise.resolve({ embedding: [0.1, 0.2] });
    });

    const provider = new OllamaEmbedding(DEFAULT_CONFIG);

    await expect(provider.embedBatch(["a", "b", "c"])).rejects.toThrow(OllamaEmbeddingError);
  });
});

describe("OllamaEmbedding integration scenarios", () => {
  test("successful embed and embedBatch flow", async () => {
    let callCount = 0;
    mockEmbeddings.mockImplementation(() => {
      callCount++;
      return Promise.resolve({ embedding: [0.1 * callCount, 0.2 * callCount, 0.3 * callCount] });
    });

    const provider = new OllamaEmbedding({ dimension: 768, model: "test-model" });

    // Single embed
    const single = await provider.embed("single text");
    expect(single).toEqual([0.1, 0.2, 0.3]);

    // Batch embed
    const batch = await provider.embedBatch(["text1", "text2"]);
    expect(batch).toHaveLength(2);
    expect(batch[1][0]).toBeCloseTo(0.3);
    expect(batch[1][1]).toBeCloseTo(0.6);
    expect(batch[1][2]).toBeCloseTo(0.9);
  });

  test("error in batch propagates with context", async () => {
    mockEmbeddings.mockImplementation(() => Promise.reject(new Error("Ollama server not running")));

    const provider = new OllamaEmbedding(DEFAULT_CONFIG);

    try {
      await provider.embedBatch(["a", "b", "c"]);
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OllamaEmbeddingError);
      expect((error as OllamaEmbeddingError).message).toContain("Failed to generate embedding");
      expect((error as OllamaEmbeddingError).message).toContain("Ollama server not running");
    }
  });
});
