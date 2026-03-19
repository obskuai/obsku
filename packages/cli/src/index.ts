#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initProject } from "./commands/init";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

interface PackageJson {
  version: string;
  name: string;
}

function getPackageJson(): PackageJson {
  const pkgPath = join(__dirname, "..", "package.json");
  const content = readFileSync(pkgPath, "utf-8");
  return JSON.parse(content) as PackageJson;
}

function showVersion(): void {
  const pkg = getPackageJson();
  console.log(pkg.version);
}

function showHelp(): void {
  console.log(`obsku - CLI for @obsku/framework

Usage:
  obsku <command> [options]

Commands:
  init          Create a new obsku project scaffold

Options:
  --version, -v  Show version
  --help, -h     Show this help message

Examples:
  obsku --version
  obsku init my-agent`);
}

function dispatch(command: string, args: string[]): void {
  switch (command) {
    case "--version":
    case "-v":
      showVersion();
      break;
    case "--help":
    case "-h":
      showHelp();
      break;
    case "init": {
      const projectName = args[1] || "my-obsku-project";
      initProject(projectName);
      break;
    }
    default:
      console.error(`Error: Unknown command '${command}'`);
      console.error("Run 'obsku --help' for usage");
      process.exit(1);
  }
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showHelp();
    return;
  }

  const command = args[0];
  dispatch(command, args);
}

main();
