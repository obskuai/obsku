import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// List of packages that should have the files field
const PACKAGES_NEEDING_FILES = [
  "packages/adapters/claude-code",
  "packages/checkpoint-redis",
  "packages/checkpoint-postgres",
  "packages/checkpoint-sqlite",
  "packages/framework",
  "packages/providers/bedrock",
  "packages/providers/ollama",
  "packages/adapters/agent-server",
  "packages/tools/code-interpreter",
  "packages/tools/code-interpreter-agentcore",
  "packages/tools/fs",
  "packages/tools/shell",
  "packages/tools/search",
];

describe("npm packaging", () => {
  test("all packages have files field with correct entries", () => {
    const failures: Array<string> = [];

    const rootDir = join(process.cwd());

    for (const pkgPath of PACKAGES_NEEDING_FILES) {
      const packageJsonPath = join(rootDir, pkgPath, "package.json");

      if (!existsSync(packageJsonPath)) {
        failures.push(`Missing package.json at ${pkgPath}`);
        continue;
      }

      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));

      if (!pkg.files) {
        failures.push(`${pkgPath}/package.json missing "files" field`);
        continue;
      }

      // Check that dist/ is included
      if (!pkg.files.includes("dist/")) {
        failures.push(`${pkgPath}/package.json "files" missing "dist/"`);
      }

      // Check that src/ is NOT included (source shouldn't be published)
      if (pkg.files.includes("src/")) {
        failures.push(`${pkgPath}/package.json "files" should not include "src/"`);
      }

      // Check that package.json is included
      if (!pkg.files.includes("package.json")) {
        failures.push(`${pkgPath}/package.json "files" missing "package.json"`);
      }

      // Check that README.md is included
      if (!pkg.files.includes("README.md")) {
        failures.push(`${pkgPath}/package.json "files" missing "README.md"`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Packaging errors:\n${failures.join("\n")}`);
    }

    expect(failures).toHaveLength(0);
  });
});
