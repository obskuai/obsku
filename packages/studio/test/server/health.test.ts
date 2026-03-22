import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { serve } from "@hono/node-server";
import { createApp, STUDIO_VERSION } from "../../src/server/index.js";

function getRandomPort(): number {
  return 30000 + Math.floor(Math.random() * 1000);
}

describe("Health Endpoint", () => {
  let server: ReturnType<typeof serve>;
  let port: number;
  let baseUrl: string;

  beforeAll(async () => {
    port = getRandomPort();
    const app = createApp({ enableLogging: false });

    server = serve({
      fetch: app.fetch,
      port,
    });

    baseUrl = `http://localhost:${port}`;
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(() => {
    server.close();
  });

  it("GET /api/health returns ok status with version", async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      status: "ok",
      version: STUDIO_VERSION,
    });
  });

  it("GET /api/unknown returns 404 with error code", async () => {
    const response = await fetch(`${baseUrl}/api/unknown`);

    expect(response.status).toBe(404);

    const data = await response.json();
    expect(data).toEqual({
      error: "Not Found",
      code: "ROUTE_NOT_FOUND",
    });
  });

  it("CORS headers are present for localhost origin", async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
      },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});
