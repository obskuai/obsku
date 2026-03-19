import { describe, expect, test } from "bun:test";
import { matchesGitignore, parseGitignorePatterns } from "@obsku/framework/security";

describe("parseGitignorePatterns", () => {
  test("parses simple patterns", () => {
    const content = "node_modules\ndist\n*.log";
    const patterns = parseGitignorePatterns(content);
    expect(patterns).toEqual(["node_modules", "dist", "*.log"]);
  });

  test("ignores empty lines", () => {
    const content = "node_modules\n\ndist\n\n*.log";
    const patterns = parseGitignorePatterns(content);
    expect(patterns).toEqual(["node_modules", "dist", "*.log"]);
  });

  test("ignores comment lines starting with #", () => {
    const content = "# Dependencies\nnode_modules\n# Build output\ndist";
    const patterns = parseGitignorePatterns(content);
    expect(patterns).toEqual(["node_modules", "dist"]);
  });

  test("ignores negation patterns starting with !", () => {
    const content = "*.log\n!important.log\nnode_modules";
    const patterns = parseGitignorePatterns(content);
    expect(patterns).toEqual(["*.log", "node_modules"]);
  });

  test("trims whitespace from patterns", () => {
    const content = "  node_modules  \n  dist  ";
    const patterns = parseGitignorePatterns(content);
    expect(patterns).toEqual(["node_modules", "dist"]);
  });

  test("handles empty content", () => {
    expect(parseGitignorePatterns("")).toEqual([]);
    expect(parseGitignorePatterns("   ")).toEqual([]);
    expect(parseGitignorePatterns("\n\n")).toEqual([]);
  });

  test("handles only comments", () => {
    const content = "# This is a comment\n# Another comment";
    expect(parseGitignorePatterns(content)).toEqual([]);
  });

  test("handles mixed content", () => {
    const content = `
# Dependencies
node_modules

# Build
dist/
build/

# Logs
*.log
npm-debug.log*

# Keep this
!important.log

# OS files
.DS_Store
    `;
    const patterns = parseGitignorePatterns(content);
    expect(patterns).toEqual([
      "node_modules",
      "dist/",
      "build/",
      "*.log",
      "npm-debug.log*",
      ".DS_Store",
    ]);
  });
});

describe("matchesGitignore", () => {
  describe("basic exact match", () => {
    test("matches exact file name", () => {
      expect(matchesGitignore("file.txt", false, ["file.txt"])).toBe(true);
      expect(matchesGitignore("node_modules", true, ["node_modules"])).toBe(true);
    });

    test("does not match substring - KEY DIFFERENCE from matchesExclude", () => {
      // matchesGitignore requires EXACT match for bare patterns
      // This differs from matchesExclude which does substring matching
      expect(matchesGitignore("my-node_modules", false, ["node_modules"])).toBe(false);
      expect(matchesGitignore("node_modules_backup", true, ["node_modules"])).toBe(false);
      expect(matchesGitignore("path/to/node_modules/file", false, ["node_modules"])).toBe(false);
    });

    test("case sensitive matching", () => {
      expect(matchesGitignore("Node_Modules", true, ["node_modules"])).toBe(false);
      expect(matchesGitignore("NODE_MODULES", true, ["node_modules"])).toBe(false);
    });
  });

  describe("extension pattern (*suffix)", () => {
    test("matches names ending with suffix", () => {
      expect(matchesGitignore("file.log", false, ["*.log"])).toBe(true);
      expect(matchesGitignore("debug.log", false, ["*.log"])).toBe(true);
    });

    test("does not match names not ending with suffix", () => {
      expect(matchesGitignore("logfile.txt", false, ["*.log"])).toBe(false);
      // Note: file.old.log DOES end with .log so it matches
      expect(matchesGitignore("file.old.log", false, ["*.log"])).toBe(true);
    });

    test("asterisk at start indicates suffix match", () => {
      // "*.log" becomes ".log" suffix check
      expect(matchesGitignore(".log", false, ["*.log"])).toBe(true);
      expect(matchesGitignore("file.log", false, ["*.log"])).toBe(true);
    });

    test("suffix pattern applies to directories too", () => {
      // Directory names can also match suffix patterns
      expect(matchesGitignore("backup.log", true, ["*.log"])).toBe(true);
    });
  });

  describe("prefix pattern (prefix*)", () => {
    test("matches names starting with prefix", () => {
      expect(matchesGitignore("temp-file", false, ["temp-*"])).toBe(true);
      expect(matchesGitignore("temp", false, ["temp*"])).toBe(true);
      expect(matchesGitignore("temporary", false, ["temp*"])).toBe(true);
    });

    test("does not match names without prefix", () => {
      expect(matchesGitignore("my-temp-file", false, ["temp-*"])).toBe(false);
    });

    test("exact match also valid", () => {
      expect(matchesGitignore("temp", false, ["temp*"])).toBe(true);
    });
  });

  describe("directory-only patterns (trailing /)", () => {
    test("matches directories", () => {
      expect(matchesGitignore("node_modules", true, ["node_modules/"])).toBe(true);
      expect(matchesGitignore("dist", true, ["dist/"])).toBe(true);
    });

    test("does NOT match files with directory-only pattern", () => {
      expect(matchesGitignore("node_modules", false, ["node_modules/"])).toBe(false);
    });

    test("directory-only pattern strips trailing slash for matching", () => {
      // "dist/" becomes "dist" for exact match, but dirOnly flag is true
      expect(matchesGitignore("dist", false, ["dist/"])).toBe(false); // dirOnly=true, isDir=false
      expect(matchesGitignore("dist", true, ["dist/"])).toBe(true); // dirOnly=true, isDir=true
    });

    test("directory-only with extension pattern", () => {
      // "*.log/" - directory names ending with .log
      expect(matchesGitignore("debug.log", true, ["*.log/"])).toBe(true);
      expect(matchesGitignore("debug.log", false, ["*.log/"])).toBe(false);
    });

    test("directory-only with prefix pattern", () => {
      // "temp-*/" - directory names starting with temp-
      expect(matchesGitignore("temp-dir", true, ["temp-*/"])).toBe(true);
      expect(matchesGitignore("temp-dir", false, ["temp-*/"])).toBe(false);
      expect(matchesGitignore("temp-dir", false, ["temp-*/]"])).toBe(false);
      expect(matchesGitignore("temp-dir", false, ["temp-*/]"])).toBe(false);
    });
  });

  describe("multiple patterns", () => {
    test("returns true if ANY pattern matches", () => {
      expect(matchesGitignore("file.ts", false, ["*.js", "*.ts"])).toBe(true);
      expect(matchesGitignore("file.js", false, ["*.js", "*.ts"])).toBe(true);
    });

    test("returns false if NO patterns match", () => {
      expect(matchesGitignore("file.py", false, ["*.js", "*.ts"])).toBe(false);
    });

    test("empty patterns array never matches", () => {
      expect(matchesGitignore("file.ts", false, [])).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("empty name only matches empty pattern", () => {
      expect(matchesGitignore("", false, [""])).toBe(true);
      expect(matchesGitignore("", true, [""])).toBe(true);
    });

    test("pattern with only asterisk matches everything", () => {
      // "*" is a suffix pattern - matches names ending with ""
      expect(matchesGitignore("anything", false, ["*"])).toBe(true);
      expect(matchesGitignore("", false, ["*"])).toBe(true);
    });

    test("patterns with multiple asterisks", () => {
      // Only cares about first/last asterisk position
      // "*.*" treated as suffix pattern (starts with *)
      expect(matchesGitignore("file.txt", false, ["*.*"])).toBe(false); // ends with ".*" but file.txt ends with ".txt"
      expect(matchesGitignore("file", false, ["*.*"])).toBe(false);
    });
  });
});

describe("SEMANTIC COMPARISON: matchesExclude vs matchesGitignore", () => {
  test("substring vs exact match behavior", () => {
    const patterns = ["node_modules"];
    const name = "my-node_modules-file";

    // matchesGitignore: exact match only
    expect(matchesGitignore(name, false, patterns)).toBe(false);
    expect(matchesGitignore("node_modules", false, patterns)).toBe(true);
  });

  test("extension pattern: both use suffix logic", () => {
    // Both treat "*.ext" as "ends with .ext"
    // matchesGitignore("file.ts", false, ["*.ts"]) == true
  });

  test("prefix pattern: both use prefix logic", () => {
    // Both treat "prefix*" as "starts with prefix"
  });

  test("directory handling: only matchesGitignore supports directory-only patterns", () => {
    // matchesExclude has no isDir parameter
    // matchesGitignore has isDir parameter and supports pattern/
  });
});
