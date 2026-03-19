import type { LLMProvider } from "@obsku/framework";
import { createBunServer, createHealthHandler as sharedHealthHandler } from "./shared";

export { HTTP_STATUS } from "./constants";
export { createErrorResponse, createSSEStream, createWriteErr } from "./shared";

const DEFAULT_MAX_BODY_SIZE = 1_048_576; // 1MB

/**
 * Parse JSON from request body. Logs error via writeErr then re-throws.
 * Rejects bodies larger than maxBodySize (default 1MB).
 */
export async function parseJsonBody(
  req: Request,
  writeErr?: (msg: string) => void,
  tag = "[Server]",
  maxBodySize = DEFAULT_MAX_BODY_SIZE
): Promise<unknown> {
  // Check content-length header first
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    if (!isNaN(length) && length > maxBodySize) {
      writeErr?.(`${tag} Request body too large: ${length} bytes`);
      throw new Error("PAYLOAD_TOO_LARGE");
    }
  }

  // Clone and check actual body size
  const clonedReq = req.clone();
  const buffer = await clonedReq.arrayBuffer();
  if (buffer.byteLength > maxBodySize) {
    writeErr?.(`${tag} Request body too large: ${buffer.byteLength} bytes`);
    throw new Error("PAYLOAD_TOO_LARGE");
  }

  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch (error: unknown) {
    writeErr?.(`${tag} JSON parse error: ${String(error)}`);
    throw error;
  }
}

export { createHealthHandler } from "./shared";

/**
 * Create a Bun HTTP server with built-in GET /ping health endpoint.
 * Handler callback receives pre-parsed URL for convenience.
 */
export function createServerConfig(
  port: number,
  hostname: string,
  writeErr: (msg: string) => void,
  handler: (req: Request, url: URL) => Response | Promise<Response>
): ReturnType<typeof Bun.serve> {
  return createBunServer(port, hostname, writeErr, async (req) => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/ping") {
      return sharedHealthHandler();
    }
    return handler(req, url);
  });
}

/**
 * Resolve LLM provider: use providerFactory if model is present, else return default.
 * Logs and throws on factory failure.
 */
export async function resolveProvider(
  defaultProvider: LLMProvider,
  model: string | undefined,
  providerFactory?: (model: string) => LLMProvider | Promise<LLMProvider>,
  writeErr?: (msg: string) => void,
  tag = "[Server]"
): Promise<LLMProvider> {
  if (providerFactory && model) {
    try {
      return await providerFactory(model);
    } catch (error: unknown) {
      writeErr?.(`${tag} provider factory failed: ${String(error)}`);
      throw error;
    }
  }
  return defaultProvider;
}
