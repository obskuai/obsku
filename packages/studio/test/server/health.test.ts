import { describe, expect, it } from "bun:test";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp, STUDIO_VERSION } from "../../src/server/index.js";

function getRandomPort(): number {
  return 30000 + Math.floor(Math.random() * 1000);
}

function fetchWithNode(
  url: string,
  options: { method?: string; headers?: Record<string, string> }
): Promise<{ status: number; headers: Headers }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === "string") {
            headers.set(key, value);
          } else if (Array.isArray(value)) {
            headers.set(key, value.join(", "));
          }
        }
        res.resume();
        resolve({ status: res.statusCode ?? 0, headers });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Health Endpoint", () => {
  it("GET /api/health returns ok status with version", async () => {
    const app = createApp({ enableLogging: false });

    const response = await app.fetch(new Request("http://localhost/api/health"));

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      status: "ok",
      version: STUDIO_VERSION,
    });
  });

  it("GET /api/unknown returns 404 with error code", async () => {
    const app = createApp({ enableLogging: false });

    const response = await app.fetch(new Request("http://localhost/api/unknown"));

    expect(response.status).toBe(404);

    const data = await response.json();
    expect(data).toEqual({
      error: "Not Found",
      code: "ROUTE_NOT_FOUND",
    });
  });

  it("CORS headers are present for localhost origin", async () => {
    const { serve } = await import("@hono/node-server");
    const app = createApp({ enableLogging: false });
    const port = getRandomPort();
    const server = serve({ fetch: app.fetch, port });

    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      const response = await fetchWithNode(`http://localhost:${port}/api/health`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "GET",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    } finally {
      server.close();
    }
  });
});
