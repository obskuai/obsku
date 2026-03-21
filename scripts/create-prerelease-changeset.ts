#!/usr/bin/env bun

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = new URL("../", import.meta.url);
const PACKAGE_ROOT = new URL("../packages/", import.meta.url);
const CHANGESET_PATH = new URL("../.changeset/prerelease-generated.md", import.meta.url);

interface PackageManifest {
  name?: string;
  private?: boolean;
}

async function findPackageJsonPaths(dir: URL, depth = 0): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const packageJsonPaths: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const entryUrl = new URL(`${entry.name}/`, dir);
    const packageJsonUrl = new URL("package.json", entryUrl);

    try {
      await readFile(packageJsonUrl, "utf8");
      packageJsonPaths.push(packageJsonUrl.pathname);
      continue;
    } catch {
      if (depth < 1) {
        packageJsonPaths.push(...(await findPackageJsonPaths(entryUrl, depth + 1)));
      }
    }
  }

  return packageJsonPaths;
}

async function main(): Promise<void> {
  const packageJsonPaths = await findPackageJsonPaths(PACKAGE_ROOT);
  const publishablePackages: string[] = [];

  for (const packageJsonPath of packageJsonPaths.sort()) {
    const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageManifest;

    if (manifest.private === true) {
      continue;
    }

    if (typeof manifest.name !== "string" || !manifest.name.startsWith("@obsku/")) {
      continue;
    }

    publishablePackages.push(manifest.name);
  }

  if (publishablePackages.length === 0) {
    throw new Error("No publishable @obsku packages found for prerelease snapshot");
  }

  const frontmatter = publishablePackages.map((name) => `"${name}": patch`).join("\n");
  const content = `---\n${frontmatter}\n---\n\nGenerated prerelease snapshot changeset.\n`;

  await writeFile(CHANGESET_PATH, content, "utf8");
  process.stdout.write(`${join(REPO_ROOT.pathname, ".changeset/prerelease-generated.md")}\n`);
}

await main();
