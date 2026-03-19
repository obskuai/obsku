#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  version?: string;
  workspaces?: Array<string>;
}

const WORKSPACE_PREFIX = "workspace:";
const BACKUP_SUFFIX = ".workspace-backup";

function findPackageJsonPath(): string {
  const cwd = process.cwd();
  const packageJsonPath = join(cwd, "package.json");
  if (!existsSync(packageJsonPath)) {
    process.stderr.write("Error: package.json not found in current directory" + "\n");
    process.exit(1);
  }
  return packageJsonPath;
}

function findWorkspaceRoot(startPath: string): string {
  let currentDir = resolve(startPath);
  while (currentDir !== "/") {
    const rootPackageJson = join(currentDir, "package.json");
    if (existsSync(rootPackageJson)) {
      const content = readFileSync(rootPackageJson, "utf8");
      const pkg = JSON.parse(content) as PackageJson;
      if (pkg.workspaces) {
        return currentDir;
      }
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  process.stderr.write("Error: Could not find workspace root" + "\n");
  process.exit(1);
}

function getAllWorkspacePackages(workspaceRoot: string): Map<string, string> {
  const packages = new Map<string, string>();
  const rootPackageJson = join(workspaceRoot, "package.json");
  const content = readFileSync(rootPackageJson, "utf8");
  const rootPkg = JSON.parse(content) as PackageJson;

  if (!rootPkg.workspaces || !Array.isArray(rootPkg.workspaces)) {
    process.stderr.write("Error: Invalid workspaces configuration" + "\n");
    process.exit(1);
  }

  for (const pattern of rootPkg.workspaces) {
    const basePath = pattern.replace(/\/\*$/, "");
    const fullBasePath = resolve(workspaceRoot, basePath);
    if (pattern.endsWith("/*")) {
      const entries = findPackageDirs(fullBasePath);
      for (const entry of entries) {
        const pkgPath = join(entry, "package.json");
        if (existsSync(pkgPath)) {
          const pkgContent = readFileSync(pkgPath, "utf8");
          const pkg = JSON.parse(pkgContent) as PackageJson;
          if (pkg.name && pkg.version) {
            packages.set(pkg.name, pkg.version);
          }
        }
      }
    }
  }
  return packages;
}

function findPackageDirs(dir: string): Array<string> {
  const results: Array<string> = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          if (existsSync(join(fullPath, "package.json"))) {
            results.push(fullPath);
          } else {
            results.push(...findPackageDirs(fullPath));
          }
        }
      } catch {
        // ignore stat errors
      }
    }
  } catch {
    // ignore readdir errors
  }
  return results;
}

function resolveWorkspaceDeps(
  pkg: PackageJson,
  workspacePackages: Map<string, string>
): {
  hasChanges: boolean;
  originalDeps: Record<string, Record<string, string>>;
  updated: PackageJson;
} {
  const updated = { ...pkg };
  const originalDeps: Record<string, Record<string, string>> = {};
  let hasChanges = false;

  const depTypes: Array<"dependencies" | "devDependencies"> = ["dependencies", "devDependencies"];

  for (const depType of depTypes) {
    const deps = pkg[depType];
    if (!deps) {
      continue;
    }

    for (const [name, version] of Object.entries(deps)) {
      if (version.startsWith(WORKSPACE_PREFIX)) {
        const actualVersion = workspacePackages.get(name);
        if (!actualVersion) {
          process.stderr.write(`Warning: Could not find workspace package "${name}"` + "\n");
          continue;
        }
        if (!originalDeps[depType]) {
          originalDeps[depType] = {};
        }
        originalDeps[depType][name] = version;
        if (!updated[depType]) {
          updated[depType] = { ...deps };
        }
        updated[depType]![name] = actualVersion;
        hasChanges = true;
        process.stdout.write(`Resolving ${name}: ${version} -> ${actualVersion}` + "\n");
      }
    }
  }
  return { hasChanges, originalDeps, updated };
}

function main() {
  const packageJsonPath = findPackageJsonPath();
  const packageDir = dirname(packageJsonPath);
  const workspaceRoot = findWorkspaceRoot(packageDir);

  process.stdout.write(`Workspace root: ${workspaceRoot}` + "\n");
  process.stdout.write(`Processing: ${packageJsonPath}` + "\n");

  const content = readFileSync(packageJsonPath, "utf8");
  const pkg = JSON.parse(content) as PackageJson;
  const workspacePackages = getAllWorkspacePackages(workspaceRoot);
  const { hasChanges, originalDeps, updated } = resolveWorkspaceDeps(pkg, workspacePackages);

  if (!hasChanges) {
    process.stdout.write("No workspace:* dependencies found" + "\n");
    return;
  }

  const backupPath = packageJsonPath + BACKUP_SUFFIX;
  const backup = {
    ...pkg,
    _workspaceBackup: { originalDeps, timestamp: new Date().toISOString() },
  };
  writeFileSync(backupPath, JSON.stringify(backup, null, 2) + "\n");
  process.stdout.write(`Backup created: ${backupPath}` + "\n");

  writeFileSync(packageJsonPath, JSON.stringify(updated, null, 2) + "\n");
  process.stdout.write("Package.json updated with resolved versions" + "\n");
}

main();
