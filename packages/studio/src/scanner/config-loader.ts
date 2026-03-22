import type { AgentDef, Graph } from "@obsku/framework";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { z } from "zod";

const StudioConfigSchema = z.object({
  agents: z.array(z.any()).optional().default([]),
  graphs: z.array(z.any()).optional().default([]),
  scanDir: z.string().optional(),
  scanIgnore: z.array(z.string()).optional().default([]),
});

export interface StudioConfig {
  agents: AgentDef[];
  graphs: Graph[];
  scanDir?: string;
  scanIgnore: string[];
}

export interface ConfigLoadResult {
  config: StudioConfig;
  configPath: string;
}

const CONFIG_FILES = ["studio.config.ts", "studio.config.js"];

function findConfigFile(cwd: string): string | null {
  for (const filename of CONFIG_FILES) {
    const configPath = resolve(cwd, filename);
    if (existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}

export async function loadStudioConfig(
  cwd: string = process.cwd()
): Promise<ConfigLoadResult | null> {
  const configPath = findConfigFile(cwd);

  if (!configPath) {
    return null;
  }

  const configModule = await importFreshModule(configPath);
  const rawConfig = configModule.default ?? configModule;

  const parseResult = StudioConfigSchema.safeParse(rawConfig);

  if (!parseResult.success) {
    throw new Error(`Invalid studio.config.ts at ${configPath}: ${parseResult.error.message}`);
  }

  const validated = parseResult.data;

  return {
    configPath,
    config: {
      agents: validated.agents as AgentDef[],
      graphs: validated.graphs as Graph[],
      scanDir: validated.scanDir,
      scanIgnore: validated.scanIgnore,
    },
  };
}

async function importFreshModule(modulePath: string): Promise<Record<string, unknown>> {
  const tempPath = `${modulePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`;
  writeFileSync(tempPath, readFileSync(modulePath, "utf8"));

  try {
    return (await import(pathToFileURL(tempPath).href)) as Record<string, unknown>;
  } finally {
    rmSync(tempPath, { force: true });
  }
}

export function mergeAgents(configAgents: AgentDef[], scannedAgents: AgentDef[]): AgentDef[] {
  const configAgentNames = new Set(configAgents.map((a) => a.name));
  const filteredScanned = scannedAgents.filter((a) => !configAgentNames.has(a.name));
  return [...configAgents, ...filteredScanned];
}

export function mergeGraphs(configGraphs: Graph[], scannedGraphs: Graph[]): Graph[] {
  const configGraphIds = new Set(configGraphs.map((g) => g.entry));
  const filteredScanned = scannedGraphs.filter((g) => !configGraphIds.has(g.entry));
  return [...configGraphs, ...filteredScanned];
}
