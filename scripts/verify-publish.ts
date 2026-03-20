#!/usr/bin/env bun
/* eslint-disable no-console */
/**
 * verify-publish.ts
 *
 * Checks that all publishable packages have correct entrypoints and manifest fields.
 * Does NOT publish or pack anything — read-only manifest + filesystem checks.
 *
 * Exit 0: all checks pass
 * Exit 1: one or more checks fail (broken package/field printed)
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// --- Types ---

interface PackageEntry {
  name: string;
  /** Path relative to repo root */
  path: string;
  /** true = intends to be published to npm; false = internal-only */
  publishable: boolean;
}

interface PackageManifest {
  exports?: Record<string, string | Record<string, string>>;
  files?: Array<string>;
  main?: string;
  name?: string;
  types?: string;
}

// --- Publishability Matrix ---
// Single source of truth for all packages under packages/.
// Update this list when adding/removing packages.
const MATRIX: Array<PackageEntry> = [
  // Core framework
  { name: "@obsku/framework", path: "packages/framework", publishable: true },

  // Providers
  { name: "@obsku/provider-ai-sdk", path: "packages/providers/ai-sdk", publishable: true },
  { name: "@obsku/provider-bedrock", path: "packages/providers/bedrock", publishable: true },
  { name: "@obsku/provider-ollama", path: "packages/providers/ollama", publishable: true },

  // Adapters
  {
    name: "@obsku/adapter-agent-server",
    path: "packages/adapters/agent-server",
    publishable: true,
  },
  {
    name: "@obsku/adapter-claude-code",
    path: "packages/adapters/claude-code",
    publishable: true,
  },
  // Checkpoint backends

  { name: "@obsku/checkpoint-sqlite", path: "packages/checkpoint-sqlite", publishable: true },
  { name: "@obsku/checkpoint-redis", path: "packages/checkpoint-redis", publishable: true },
  { name: "@obsku/checkpoint-postgres", path: "packages/checkpoint-postgres", publishable: true },

  // Tools
  {
    name: "@obsku/tool-code-interpreter",
    path: "packages/tools/code-interpreter",
    publishable: true,
  },
  {
    name: "@obsku/tool-code-interpreter-agentcore",
    path: "packages/tools/code-interpreter-agentcore",
    publishable: true,
  },
  {
    name: "@obsku/tool-code-interpreter-wasm",
    path: "packages/tools/code-interpreter-wasm",
    publishable: true,
  },
  { name: "@obsku/tool-fs", path: "packages/tools/fs", publishable: true },
  { name: "@obsku/tool-search", path: "packages/tools/search", publishable: true },
  { name: "@obsku/tool-shell", path: "packages/tools/shell", publishable: true },
  { name: "@obsku/tool-shell-sandbox", path: "packages/tools/shell-sandbox", publishable: true },

  // Utilities
  { name: "@obsku/cli", path: "packages/cli", publishable: true },
];

// --- Helpers ---

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");

function absPath(pkgRelPath: string, fileRef: string): string {
  return join(REPO_ROOT, pkgRelPath, fileRef);
}

function checkFile(pkgPath: string, field: string, value: string): string | null {
  if (!existsSync(absPath(pkgPath, value))) {
    return `${field} '${value}' not found`;
  }
  return null;
}

/**
 * Check whether a relative file path (e.g. "./src/index.ts") would be included
 * in the npm tarball given the package's "files" allowlist.
 *
 * npm "files" semantics:
 *   - "dist/"  → includes everything under dist/
 *   - "dist"   → same as "dist/" (directory)
 *   - package.json, README, LICENSE are always included regardless of "files"
 */
function isCoveredByFiles(filePath: string, files: Array<string>): boolean {
  const alwaysIncluded = ["package.json", "readme", "license", "licence", "changelog"];
  const normalised = filePath.replace(/^\.\//, "").toLowerCase();
  if (alwaysIncluded.some((f) => normalised === f || normalised.startsWith(`${f}.`))) {
    return true;
  }

  const targetPath = filePath.replace(/^\.\//, "");
  for (const pattern of files) {
    const prefix = pattern.replace(/\/+$/, "");
    if (targetPath === prefix || targetPath.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

function collectExportPaths(
  exports: Record<string, string | Record<string, string>>
): Array<{ field: string; path: string }> {
  const paths: Array<{ field: string; path: string }> = [];
  for (const [exportKey, conditions] of Object.entries(exports)) {
    if (typeof conditions === "string") {
      paths.push({ field: `exports['${exportKey}']`, path: conditions });
    } else if (typeof conditions === "object" && conditions !== null) {
      for (const [condName, condTarget] of Object.entries(conditions)) {
        if (typeof condTarget === "string") {
          paths.push({ field: `exports['${exportKey}'].${condName}`, path: condTarget });
        }
      }
    }
  }
  return paths;
}

function collectExportFailures(
  pkgPath: string,
  exports: Record<string, string | Record<string, string>>
): Array<string> {
  const failures: Array<string> = [];
  for (const { field, path } of collectExportPaths(exports)) {
    const err = checkFile(pkgPath, field, path);
    if (err) {
      failures.push(err);
    }
  }
  return failures;
}

/**
 * Verify every path in exports/main/types is covered by "files" allowlist.
 * Catches the case where a file exists on disk but would be missing from the npm tarball.
 */
function collectFilesCoverageFailures(pkg: PackageManifest): Array<string> {
  const files = pkg.files;
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  const failures: Array<string> = [];

  if (pkg.main && !isCoveredByFiles(pkg.main, files)) {
    failures.push(
      `main '${pkg.main}' is NOT covered by files ${JSON.stringify(files)} — will be missing from npm tarball`
    );
  }

  if (pkg.types && !isCoveredByFiles(pkg.types, files)) {
    failures.push(
      `types '${pkg.types}' is NOT covered by files ${JSON.stringify(files)} — will be missing from npm tarball`
    );
  }

  if (pkg.exports) {
    for (const { field, path } of collectExportPaths(pkg.exports)) {
      if (!isCoveredByFiles(path, files)) {
        failures.push(
          `${field} '${path}' is NOT covered by files ${JSON.stringify(files)} — will be missing from npm tarball`
        );
      }
    }
  }

  return failures;
}

// --- Main ---

let anyFailed = false;
const publishableNames: Array<string> = [];
const internalNames: Array<string> = [];

console.log("=== verify:publish ===\n");

for (const entry of MATRIX) {
  if (!entry.publishable) {
    internalNames.push(entry.name);
    console.log(`SKIP  ${entry.name}  (internal-only)`);
    continue;
  }

  publishableNames.push(entry.name);

  // Gracefully handle missing package directory
  const pkgJsonPath = absPath(entry.path, "package.json");
  if (!existsSync(pkgJsonPath)) {
    console.log(`FAIL  ${entry.name}`);
    console.log(`        - package.json not found at ${pkgJsonPath}`);
    anyFailed = true;
    continue;
  }

  let pkg: PackageManifest;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as PackageManifest;
  } catch (error) {
    console.log(`FAIL  ${entry.name}`);
    console.log(`        - failed to parse package.json: ${error}`);
    anyFailed = true;
    continue;
  }

  const failures: Array<string> = [];

  // 1. 'files' allowlist must be present
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    failures.push("'files' allowlist is missing or empty");
  }

  // 2. 'main' entrypoint must exist on disk
  if (pkg.main) {
    const err = checkFile(entry.path, "main", pkg.main);
    if (err) {
      failures.push(err);
    }
  } else {
    failures.push("'main' field is missing");
  }

  // 3. Top-level 'types' field must exist on disk
  if (pkg.types) {
    const err = checkFile(entry.path, "types", pkg.types);
    if (err) {
      failures.push(err);
    }
  } else {
    failures.push("'types' field is missing");
  }

  // 4. All 'exports' targets must exist on disk
  if (pkg.exports) {
    const exportFailures = collectExportFailures(entry.path, pkg.exports);
    failures.push(...exportFailures);
  }

  // 5. All exports/main/types paths must be covered by 'files' allowlist
  //    (catches: file exists on disk but would be missing from npm tarball)
  const coverageFailures = collectFilesCoverageFailures(pkg);
  failures.push(...coverageFailures);

  if (failures.length === 0) {
    console.log(`PASS  ${entry.name}`);
  } else {
    console.log(`FAIL  ${entry.name}`);
    for (const f of failures) {
      console.log(`        - ${f}`);
    }
    anyFailed = true;
  }
}

console.log(`
--- Summary ---
Publishable (${publishableNames.length}): ${publishableNames.join(", ")}
Internal    (${internalNames.length}): ${internalNames.join(", ")}
`);

if (anyFailed) {
  console.log("RESULT: FAILED — fix the issues above before publishing");
  process.exit(1);
} else {
  console.log("RESULT: PASSED — all publishable packages are ready");
}
