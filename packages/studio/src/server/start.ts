import { serve } from "@hono/node-server";
import { createStudioApp, type StudioAppOptions } from "./index.js";

export interface ServerInstance {
  port: number;
  hostname: string;
  shutdown: () => Promise<void>;
}

export interface ServerConfig extends StudioAppOptions {
  onStart?: (port: number, hostname: string) => void;
  onError?: (error: Error) => void;
}

export function startServer(config: ServerConfig = {}): ServerInstance {
  const { onStart, onError, ...appOptions } = config;
  const { app, port: requestedPort, hostname } = createStudioApp(appOptions);

  const server = serve({
    fetch: app.fetch,
    port: requestedPort,
    hostname,
  });

  const shutdown = async (): Promise<void> => {
    server.close();
  };

  const actualPort = server.port ?? requestedPort;

  server.on("listening", () => {
    onStart?.(actualPort, hostname);
  });

  server.on("error", (error: Error) => {
    onError?.(error);
  });

  return {
    port: actualPort,
    hostname,
    shutdown,
  };
}
