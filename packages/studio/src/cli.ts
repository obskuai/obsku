#!/usr/bin/env node
/**
 * Obsku Studio CLI
 *
 * Entry point for the obsku-studio command
 */
import { parseArgs } from "node:util";
import { version } from "./index.js";

export interface CliOptions {
  port: number;
  config?: string;
  scan?: boolean;
  help: boolean;
  version: boolean;
}

export function parseCliOptions(args: string[]): CliOptions {
  const { values } = parseArgs({
    args,
    options: {
      port: {
        type: "string",
        short: "p",
        default: "3001",
      },
      config: {
        type: "string",
        short: "c",
      },
      scan: {
        type: "boolean",
        short: "s",
      },
      help: {
        type: "boolean",
        short: "h",
      },
      version: {
        type: "boolean",
        short: "v",
      },
    },
    strict: true,
    allowPositionals: false,
  });

  const port = parseInt(values.port as string, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${values.port}`);
  }

  return {
    port,
    config: values.config as string | undefined,
    scan: values.scan as boolean | undefined,
    help: (values.help as boolean) ?? false,
    version: (values.version as boolean) ?? false,
  };
}

export function printHelp(): void {
  console.log(`
Usage: obsku-studio [options]

Options:
  -p, --port <number>    Port to run the studio server (default: 3001)
  -c, --config <path>    Path to configuration file
  -s, --scan            Scan for agents in the project
  -h, --help            Show this help message
  -v, --version         Show version

Examples:
  obsku-studio                          # Start studio on default port 3001
  obsku-studio --port 3000              # Start studio on port 3000
  obsku-studio --config ./studio.config.js  # Use custom config
  obsku-studio --scan                   # Scan for agents and exit
`);
}

export function printVersion(): void {
  console.log(version);
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const options = parseCliOptions(args);

    if (options.help) {
      printHelp();
      process.exit(0);
    }

    if (options.version) {
      printVersion();
      process.exit(0);
    }

    if (options.scan) {
      console.log("Scan mode: enabled (not implemented yet)");
      process.exit(0);
    }

    console.log("Starting Obsku Studio server...");

    const { startServer } = await import("./server/start.js");

    const server = startServer({
      port: options.port,
      enableLogging: true,
      onStart: (port, hostname) => {
        console.log(`Server running at http://${hostname}:${port}`);
      },
      onError: (err) => {
        console.error("Server error:", err);
        process.exit(1);
      },
    });

    const gracefulShutdown = (): void => {
      console.log("\nShutting down server...");
      server.shutdown().then(() => {
        process.exit(0);
      });
    };

    process.on("SIGINT", gracefulShutdown);
    process.on("SIGTERM", gracefulShutdown);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}