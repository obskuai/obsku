import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import type { EmbeddingProvider } from "@obsku/framework";
import { ZodError, z } from "zod";
import { BedrockError, mapAwsError } from "./errors";

/**
 * Error class for Bedrock embedding operations.
 */
export class BedrockEmbeddingError extends BedrockError {
  constructor(
    code: ConstructorParameters<typeof BedrockError>[0],
    message: string,
    cause?: unknown
  ) {
    super(code, message, cause);
    this.name = "BedrockEmbeddingError";
  }
}

const BedrockEmbeddingResponse = z.object({
  embedding: z.array(z.number()),
});

/**
 * Known Bedrock embedding model dimensions.
 */
const MODEL_DIMENSIONS: Record<string, number> = {
  "amazon.titan-embed-text-v1": 1536,
  "amazon.titan-embed-text-v2:0": 1024,
  "cohere.embed-english-v3": 1024,
  "cohere.embed-multilingual-v3": 1024,
};

function resolveDimension(model: string): number {
  const dim = MODEL_DIMENSIONS[model];
  if (!dim) {
    throw new Error(
      `Unknown embedding model "${model}": cannot determine dimension. Known models: ${Object.keys(MODEL_DIMENSIONS).join(", ")}`
    );
  }
  return dim;
}

/**
 * Configuration for BedrockEmbedding provider.
 */
export interface BedrockEmbeddingConfig {
  /** Bedrock embedding model ID */
  model: string;
  /** AWS region (falls back to AWS_REGION env var) */
  region?: string;
}

export class BedrockEmbedding implements EmbeddingProvider {
  private client: BedrockRuntimeClient;
  readonly modelName: string;
  readonly dimension: number;

  constructor(config: BedrockEmbeddingConfig) {
    const region = config.region ?? process.env.AWS_REGION;
    if (!region) {
      throw new Error(
        "region is required: pass in BedrockEmbeddingConfig or set AWS_REGION env var"
      );
    }

    this.modelName = config.model;
    this.dimension = resolveDimension(config.model);
    this.client = new BedrockRuntimeClient({ region });
  }

  async embed(text: string): Promise<Array<number>> {
    if (!text || text.trim().length === 0) {
      throw new BedrockEmbeddingError("unknown", "Empty text provided for embedding");
    }

    const command = new InvokeModelCommand({
      accept: "application/json",
      body: JSON.stringify({ inputText: text }),
      contentType: "application/json",
      modelId: this.modelName,
    });

    try {
      const response = await this.client.send(command);
      const decodedBody = new TextDecoder().decode(response.body);
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(decodedBody);
      } catch (parseError) {
        throw new BedrockEmbeddingError("unknown", "Failed to parse embedding response", parseError);
      }
      const responseBody = BedrockEmbeddingResponse.parse(parsedBody);

      return responseBody.embedding;
    } catch (error: unknown) {
      if (error instanceof BedrockEmbeddingError) {
        throw error;
      }
      if (error instanceof ZodError) {
        throw new BedrockEmbeddingError("unknown", `Invalid embedding response: ${error.message}`);
      }
      throw mapAwsError(error);
    }
  }

  async embedBatch(texts: Array<string>): Promise<Array<Array<number>>> {
    if (!texts || texts.length === 0) {
      return [];
    }

    // Validate all texts are non-empty
    const invalidIndices = texts
      .map((t, i) => (!t || t.trim().length === 0 ? i : -1))
      .filter((i) => i !== -1);

    if (invalidIndices.length > 0) {
      throw new BedrockEmbeddingError(
        "unknown",
        `Empty text at indices: ${invalidIndices.join(", ")}`
      );
    }

    // Bedrock doesn't have native batch API, so we parallelize individual calls
    return parallelizeEmbeds(texts, (t) => this.embed(t));
  }
}

/**
 * Parallelize embedding calls for providers without native batch API.
 * @internal
 */
function parallelizeEmbeds<T>(
  texts: Array<string>,
  embedFn: (text: string) => Promise<T>
): Promise<Array<T>> {
  return Promise.all(texts.map(embedFn));
}
