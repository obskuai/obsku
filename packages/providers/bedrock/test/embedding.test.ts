import { beforeEach, describe, expect, mock, test } from "bun:test";
import { BedrockEmbedding, BedrockEmbeddingError } from "../src/embedding";

const mockSend = mock(() =>
  Promise.resolve({
    body: new TextEncoder().encode(JSON.stringify({ embedding: Array(1024).fill(0.1) })),
  })
);

mock.module("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class MockBedrockRuntimeClient {
    send = mockSend;
  },
  InvokeModelCommand: class MockInvokeModelCommand {
    constructor(public input: unknown) {}
  },
}));

const DEFAULT_CONFIG = { model: "amazon.titan-embed-text-v2:0", region: "us-east-1" } as const;

describe("BedrockEmbedding", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({ embedding: Array(1024).fill(0.1) })),
    });
  });

  describe("configuration", () => {
    test("has correct interface", () => {
      const embedder = new BedrockEmbedding(DEFAULT_CONFIG);

      expect(typeof embedder.embed).toBe("function");
      expect(typeof embedder.embedBatch).toBe("function");
      expect(typeof embedder.dimension).toBe("number");
      expect(typeof embedder.modelName).toBe("string");
    });

    test("sets model and auto-resolves dimension for titan v2", () => {
      const embedder = new BedrockEmbedding(DEFAULT_CONFIG);
      expect(embedder.modelName).toBe("amazon.titan-embed-text-v2:0");
      expect(embedder.dimension).toBe(1024);
    });

    test("resolves dimension for titan v1", () => {
      const embedder = new BedrockEmbedding({
        model: "amazon.titan-embed-text-v1",
        region: "us-east-1",
      });
      expect(embedder.modelName).toBe("amazon.titan-embed-text-v1");
      expect(embedder.dimension).toBe(1536);
    });

    test("resolves dimension for cohere models", () => {
      const e1 = new BedrockEmbedding({ model: "cohere.embed-english-v3", region: "us-east-1" });
      expect(e1.dimension).toBe(1024);

      const e2 = new BedrockEmbedding({
        model: "cohere.embed-multilingual-v3",
        region: "us-east-1",
      });
      expect(e2.dimension).toBe(1024);
    });

    test("throws on unknown model (cannot resolve dimension)", () => {
      expect(() => new BedrockEmbedding({ model: "unknown-model", region: "us-east-1" })).toThrow(
        /Unknown embedding model "unknown-model"/
      );
    });

    test("region falls back to AWS_REGION env var", () => {
      const origRegion = process.env.AWS_REGION;
      try {
        process.env.AWS_REGION = "eu-west-1";
        const embedder = new BedrockEmbedding({ model: "amazon.titan-embed-text-v2:0" });
        expect(embedder).toBeDefined();
      } finally {
        if (origRegion !== undefined) {
          process.env.AWS_REGION = origRegion;
        } else {
          delete process.env.AWS_REGION;
        }
      }
    });

    test("explicit region takes precedence over AWS_REGION", () => {
      const origRegion = process.env.AWS_REGION;
      try {
        process.env.AWS_REGION = "eu-west-1";
        const embedder = new BedrockEmbedding({
          model: "amazon.titan-embed-text-v2:0",
          region: "ap-southeast-1",
        });
        expect(embedder).toBeDefined();
      } finally {
        if (origRegion !== undefined) {
          process.env.AWS_REGION = origRegion;
        } else {
          delete process.env.AWS_REGION;
        }
      }
    });

    test("throws when no region and no AWS_REGION env var", () => {
      const origRegion = process.env.AWS_REGION;
      try {
        delete process.env.AWS_REGION;
        expect(() => new BedrockEmbedding({ model: "amazon.titan-embed-text-v2:0" })).toThrow(
          /region is required/
        );
      } finally {
        if (origRegion !== undefined) {
          process.env.AWS_REGION = origRegion;
        } else {
          delete process.env.AWS_REGION;
        }
      }
    });
  });

  describe("embed()", () => {
    test("returns embedding from API response", async () => {
      const mockEmbedding = Array(1024).fill(0.1);
      mockSend.mockResolvedValueOnce({
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: mockEmbedding,
            inputTextTokenCount: 10,
          })
        ),
      });

      const embedder = new BedrockEmbedding(DEFAULT_CONFIG);
      const result = await embedder.embed("Hello world");

      expect(result.length).toBe(1024);
      expect(result[0]).toBe(0.1);
    });

    test("sends correct InvokeModel request format", async () => {
      mockSend.mockResolvedValueOnce({
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: Array(1024).fill(0.1),
            inputTextTokenCount: 5,
          })
        ),
      });

      const embedder = new BedrockEmbedding({
        model: "amazon.titan-embed-text-v2:0",
        region: "us-west-2",
      });
      await embedder.embed("Test text");

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = (mockSend.mock.calls as Array<Array<any>>)[0][0];

      expect(command.input).toEqual({
        accept: "application/json",
        body: JSON.stringify({ inputText: "Test text" }),
        contentType: "application/json",
        modelId: "amazon.titan-embed-text-v2:0",
      });
    });

    test("throws BedrockEmbeddingError on empty text", async () => {
      const embedder = new BedrockEmbedding(DEFAULT_CONFIG);

      await expect(embedder.embed("")).rejects.toThrow(BedrockEmbeddingError);
      await expect(embedder.embed("   ")).rejects.toThrow(BedrockEmbeddingError);
    });

    test("throws error on invalid response format", async () => {
      mockSend.mockResolvedValueOnce({
        body: new TextEncoder().encode(
          JSON.stringify({
            inputTextTokenCount: 10,
          })
        ),
      });

      const embedder = new BedrockEmbedding(DEFAULT_CONFIG);
      await expect(embedder.embed("Test")).rejects.toThrow(BedrockEmbeddingError);
    });

    test("maps AWS throttling errors", async () => {
      mockSend.mockRejectedValueOnce({
        message: "Rate exceeded",
        name: "ThrottlingException",
      });

      const embedder = new BedrockEmbedding(DEFAULT_CONFIG);

      try {
        await embedder.embed("Test");
        expect(true).toBe(false);
      } catch (error) {
        expect((error as BedrockEmbeddingError).code).toBe("throttle");
      }
    });

    test("maps AWS auth errors", async () => {
      mockSend.mockRejectedValueOnce({
        message: "Access denied",
        name: "AccessDeniedException",
      });

      const embedder = new BedrockEmbedding(DEFAULT_CONFIG);

      try {
        await embedder.embed("Test");
        expect(true).toBe(false);
      } catch (error) {
        expect((error as BedrockEmbeddingError).code).toBe("auth");
      }
    });

    test("maps unknown AWS errors", async () => {
      mockSend.mockRejectedValueOnce({
        message: "Unknown error",
        name: "SomeOtherError",
      });

      const embedder = new BedrockEmbedding(DEFAULT_CONFIG);

      try {
        await embedder.embed("Test");
        expect(true).toBe(false);
      } catch (error) {
        expect((error as BedrockEmbeddingError).code).toBe("unknown");
      }
    });
  });

  describe("embedBatch()", () => {
    test("returns embeddings for multiple texts", async () => {
      const mockEmbedding1 = Array(1024).fill(0.1);
      const mockEmbedding2 = Array(1024).fill(0.2);

      mockSend
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(
            JSON.stringify({
              embedding: mockEmbedding1,
              inputTextTokenCount: 5,
            })
          ),
        })
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(
            JSON.stringify({
              embedding: mockEmbedding2,
              inputTextTokenCount: 5,
            })
          ),
        });

      const embedder = new BedrockEmbedding(DEFAULT_CONFIG);
      const results = await embedder.embedBatch(["Text 1", "Text 2"]);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(mockEmbedding1);
      expect(results[1]).toEqual(mockEmbedding2);
    });

    test("returns empty array for empty input", async () => {
      const embedder = new BedrockEmbedding(DEFAULT_CONFIG);
      const results = await embedder.embedBatch([]);
      expect(results).toEqual([]);
    });

    test("throws error on empty text in batch", async () => {
      const embedder = new BedrockEmbedding(DEFAULT_CONFIG);

      await expect(embedder.embedBatch(["Valid", "", "Also valid"])).rejects.toThrow(
        BedrockEmbeddingError
      );
    });

    test("makes parallel API calls", async () => {
      const mockEmbedding = Array(1024).fill(0.1);

      mockSend
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(JSON.stringify({ embedding: mockEmbedding })),
        })
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(JSON.stringify({ embedding: mockEmbedding })),
        })
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(JSON.stringify({ embedding: mockEmbedding })),
        });

      const embedder = new BedrockEmbedding(DEFAULT_CONFIG);
      await embedder.embedBatch(["A", "B", "C"]);

      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    test("propagates errors from individual embed calls", async () => {
      mockSend
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(
            JSON.stringify({
              embedding: Array(1024).fill(0.1),
            })
          ),
        })
        .mockRejectedValueOnce({
          message: "Rate exceeded",
          name: "ThrottlingException",
        });

      const embedder = new BedrockEmbedding(DEFAULT_CONFIG);

      try {
        await embedder.embedBatch(["Text 1", "Text 2"]);
        expect(true).toBe(false);
      } catch (error) {
        expect((error as BedrockEmbeddingError).code).toBe("throttle");
      }
    });
  });

  describe("BedrockEmbeddingError", () => {
    test("extends BedrockError with correct name", () => {
      const err = new BedrockEmbeddingError("unknown", "Test error");
      expect(err.name).toBe("BedrockEmbeddingError");
      expect(err.code).toBe("unknown");
      expect(err.message).toBe("Test error");
    });

    test("preserves error cause", () => {
      const cause = new Error("Original error");
      const err = new BedrockEmbeddingError("unknown", "Wrapped error", cause);
      expect(err.cause).toBe(cause);
    });
  });
});
