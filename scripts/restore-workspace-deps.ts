#!/usr/bin/env bun
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface PackageJson {
  _workspaceBackup?: {
    originalDeps: Record<string, Record<string, string>>;
    timestamp: string;
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  version?: string;
}

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

function main() {
  const packageJsonPath = findPackageJsonPath();
  const backupPath = packageJsonPath + BACKUP_SUFFIX;

  if (!existsSync(backupPath)) {
    process.stdout.write("No backup found, nothing to restore" + "\n");
    return;
  }

  process.stdout.write(`Restoring from: ${backupPath}` + "\n");

  const backupContent = readFileSync(backupPath, "utf8");
  const backupPkg = JSON.parse(backupContent) as PackageJson;

  if (!backupPkg._workspaceBackup) {
    process.stderr.write("Error: Invalid backup file (missing _workspaceBackup)" + "\n");
    process.exit(1);
  }

  const { originalDeps } = backupPkg._workspaceBackup;
  const currentContent = readFileSync(packageJsonPath, "utf8");
  const currentPkg = JSON.parse(currentContent) as PackageJson;
  const restored = { ...currentPkg };
  delete (restored as PackageJson)._workspaceBackup;

  for (const [depType, deps] of Object.entries(originalDeps)) {
    if (!restored[depType as keyof PackageJson]) {
      continue;
    }
    for (const [name, version] of Object.entries(deps)) {
      (restored[depType as keyof PackageJson] as Record<string, string>)[name] = version;
      process.stdout.write(`Restored ${name}: ${version}` + "\n");
    }
  }

  writeFileSync(packageJsonPath, JSON.stringify(restored, null, 2) + "\n");
  process.stdout.write("Package.json restored" + "\n");

  unlinkSync(backupPath);
  process.stdout.write(`Backup removed: ${backupPath}` + "\n");
}

main();
