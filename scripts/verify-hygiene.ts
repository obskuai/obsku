#!/usr/bin/env bun
/* eslint-disable no-console */
/**
 * verify-hygiene.ts
 *
 * Checks that no hygiene-violating artifacts are tracked by git.
 * Exits 0 on clean repo, exits 1 with offending paths listed.
 *
 * Categories of violations:
 *   PLANNING   — internal .sisyphus / .sisphus planning dirs
 *   DB         — runtime database files (*.db)
 *   SERVICE    — systemd service files (*.service)
 *   BACKUP     — prepack byproduct files (*.workspace-backup)
 *   STRAY      — known stray root artifacts (EOF, .envrc)
 */

import { execSync } from "node:child_process";

interface ViolationRule {
  category: string;
  test: (path: string) => boolean;
}

const RULES: Array<ViolationRule> = [
  {
    category: "PLANNING",
    test: (p) => p.startsWith(".sisyphus/") || p.startsWith(".sisphus/"),
  },
  {
    category: "DB",
    test: (p) => p.endsWith(".db"),
  },
  {
    category: "SERVICE",
    test: (p) => p.endsWith(".service"),
  },
  {
    category: "BACKUP",
    test: (p) => p.endsWith(".workspace-backup") || p === ".workspace-backup",
  },
  {
    category: "STRAY",
    test: (p) => p === "EOF" || (p === ".envrc" && !p.includes("/")),
  },
];

/** Run git ls-files and return the list of tracked paths */
function getTrackedFiles(): Array<string> {
  const output = execSync("git ls-files", { encoding: "utf8" });
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Check that gitignore covers each artifact class */
function verifyIgnorePatterns(): { missing: Array<string>; ok: boolean } {
  const probes = [
    ".sisyphus/test.md",
    ".sisphus/test.md",
    "temp.db",
    "temp.service",
    ".workspace-backup",
  ];

  const missing: Array<string> = [];
  for (const probe of probes) {
    try {
      execSync(`git check-ignore -q "${probe}"`, { stdio: "pipe" });
      // exit 0 = ignored ✓
    } catch {
      // exit non-zero = NOT ignored
      missing.push(probe);
    }
  }

  return { missing, ok: missing.length === 0 };
}

function main() {
  const tracked = getTrackedFiles();
  const violations: Array<{ category: string; path: string }> = [];

  for (const path of tracked) {
    for (const rule of RULES) {
      if (rule.test(path)) {
        violations.push({ category: rule.category, path });
        break; // first matching rule wins
      }
    }
  }

  const ignoreCheck = verifyIgnorePatterns();

  let hasErrors = false;

  if (violations.length > 0) {
    hasErrors = true;
    console.error(
      `\n❌ Hygiene violations — ${violations.length} tracked file(s) should not be committed:\n`
    );
    for (const { category, path } of violations) {
      console.error(`  [${category}]  ${path}`);
    }
    console.error(
      "\nRun task 18 (cleanup) to remove these from tracking, or add them to .gitignore if intentional.\n"
    );
  }

  if (!ignoreCheck.ok) {
    hasErrors = true;
    console.error(`\n⚠️  Missing gitignore coverage for:\n`);
    for (const probe of ignoreCheck.missing) {
      console.error(`  ${probe}`);
    }
    console.error("\nUpdate .gitignore to cover these artifact classes.\n");
  }

  if (!hasErrors) {
    console.log("✅ Repo hygiene OK — no violations detected.");
    console.log("   gitignore covers all artifact classes.");
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main();
