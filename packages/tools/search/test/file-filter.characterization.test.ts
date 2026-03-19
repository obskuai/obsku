import { describe, expect, test } from "bun:test";
import { matchesExclude, matchesInclude } from "../src/file-filter";

describe("matchesInclude", () => {
  describe("extension pattern (*.ext)", () => {
    test("matches files ending with extension", () => {
      expect(matchesInclude("file.ts", "*.ts")).toBe(true);
      expect(matchesInclude("deep/nested/file.ts", "*.ts")).toBe(true);
      expect(matchesInclude("file.test.ts", "*.ts")).toBe(true);
    });

    test("does not match files with different extension", () => {
      expect(matchesInclude("file.js", "*.ts")).toBe(false);
      expect(matchesInclude("file.ts.old", "*.ts")).toBe(false);
    });

    test("requires exact extension match, not just suffix", () => {
      // Note: "file.d.ts" ends with ".ts" but pattern "*.ts" matches ".ts" suffix
      // The implementation slices pattern from position 1, so "*.ts" becomes ".ts"
      expect(matchesInclude("file.d.ts", "*.ts")).toBe(true);
    });

    test("empty extension pattern behavior", () => {
      // "*." becomes "." - matches any name ending with "."
      expect(matchesInclude("file.", "*.")).toBe(true);
      expect(matchesInclude("file", "*.")).toBe(false);
    });
  });

  describe("prefix pattern (prefix*)", () => {
    test("matches names starting with prefix", () => {
      expect(matchesInclude("test-file.ts", "test-*")).toBe(true);
      expect(matchesInclude("test", "test*")).toBe(true);
      expect(matchesInclude("testing", "test*")).toBe(true);
      // Bare name without * is exact match, not prefix match
      expect(matchesInclude("testing", "test")).toBe(false);
    });

    test("does not match names without prefix", () => {
      expect(matchesInclude("my-test.ts", "test-*")).toBe(false);
      expect(matchesInclude("file.ts", "test-*")).toBe(false);
      expect(matchesInclude("my-test.ts", "test-")).toBe(false);
      expect(matchesInclude("file.ts", "test-")).toBe(false);
    });

    test("exact match is also valid prefix match", () => {
      expect(matchesInclude("test", "test*")).toBe(true);
    });
  });

  describe("exact match (name)", () => {
    test("matches exact name", () => {
      expect(matchesInclude("file.ts", "file.ts")).toBe(true);
      expect(matchesInclude("README.md", "README.md")).toBe(true);
    });

    test("does not match partial names", () => {
      // matchesInclude does NOT do substring matching for exact patterns
      expect(matchesInclude("my-file.ts", "file.ts")).toBe(false);
      expect(matchesInclude("file.ts.old", "file.ts")).toBe(false);
    });

    test("case sensitivity", () => {
      // Matches are case-sensitive
      expect(matchesInclude("File.ts", "file.ts")).toBe(false);
      expect(matchesInclude("README.md", "readme.md")).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("empty pattern only matches empty name", () => {
      expect(matchesInclude("", "")).toBe(true);
      expect(matchesInclude("file.ts", "")).toBe(false);
    });

    test("pattern with only asterisk", () => {
      // "*" is a prefix pattern (endsWith "*"), becomes "" prefix
      expect(matchesInclude("anything", "*")).toBe(true);
      expect(matchesInclude("", "*")).toBe(true);
    });
  });
});

describe("matchesExclude", () => {
  describe("extension pattern (*.ext)", () => {
    test("matches files ending with extension", () => {
      expect(matchesExclude("file.ts", ["*.ts"])).toBe(true);
      expect(matchesExclude("file.test.ts", ["*.ts"])).toBe(true);
    });

    test("does not match files with different extension", () => {
      expect(matchesExclude("file.js", ["*.ts"])).toBe(false);
    });
  });

  describe("prefix pattern (prefix*)", () => {
    test("matches names starting with prefix", () => {
      expect(matchesExclude("test-file.ts", ["test-"])).toBe(true);
      expect(matchesExclude("testing", ["test"])).toBe(true);
    });

    test("does not match names without prefix", () => {
      expect(matchesExclude("my-test.ts", ["test-"])).toBe(false);
    });
  });

  describe("exact/substring match (name)", () => {
    test("matches exact name", () => {
      expect(matchesExclude("file.ts", ["file.ts"])).toBe(true);
    });

    test("ALSO matches substring - KEY DIFFERENCE FROM matchesInclude", () => {
      // This is the critical semantic difference!
      // matchesExclude does substring matching for bare patterns
      expect(matchesExclude("my-file.ts", ["file.ts"])).toBe(true);
      expect(matchesExclude("path/to/file.ts", ["file.ts"])).toBe(true);
      expect(matchesExclude("file.ts.old", ["file.ts"])).toBe(true);
    });

    test("matches substring in directory names", () => {
      expect(matchesExclude("node_modules/package.json", ["node_modules"])).toBe(true);
      expect(matchesExclude("src/node_modules/lib.js", ["node_modules"])).toBe(true);
    });

    test("pattern anywhere in name triggers exclude", () => {
      expect(matchesExclude("prefix-test-suffix", ["test"])).toBe(true);
      expect(matchesExclude("mytestfile", ["test"])).toBe(true);
    });
  });

  describe("multiple patterns", () => {
    test("returns true if ANY pattern matches", () => {
      expect(matchesExclude("file.ts", ["*.js", "*.ts"])).toBe(true);
      expect(matchesExclude("file.js", ["*.js", "*.ts"])).toBe(true);
    });

    test("returns false if NO patterns match", () => {
      expect(matchesExclude("file.py", ["*.js", "*.ts"])).toBe(false);
    });

    test("empty patterns array never matches", () => {
      expect(matchesExclude("file.ts", [])).toBe(false);
    });
  });

  describe("combined pattern types", () => {
    test("mix of extension, prefix, and substring patterns", () => {
      const patterns = ["*.log", "temp-", "cache"];

      expect(matchesExclude("debug.log", patterns)).toBe(true); // extension
      expect(matchesExclude("temp-file.txt", patterns)).toBe(true); // prefix
      expect(matchesExclude("my-cache-dir", patterns)).toBe(true); // substring
      expect(matchesExclude("cached-data.json", patterns)).toBe(true); // substring (cache in cached)
      expect(matchesExclude("regular.txt", patterns)).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("empty pattern matches empty string or any string containing empty", () => {
      // "" is substring of everything
      expect(matchesExclude("", [""])).toBe(true);
      expect(matchesExclude("file.ts", [""])).toBe(true);
    });

    test("single character patterns", () => {
      expect(matchesExclude("file.ts", ["."])).toBe(true);
      expect(matchesExclude("filets", ["."])).toBe(false);
    });
  });
});

describe("SEMANTIC DIFFERENCES: matchesInclude vs matchesExclude", () => {
  test("exact pattern behavior differs", () => {
    const pattern = "file.ts";
    const name = "my-file.ts";

    // matchesInclude: exact match only
    expect(matchesInclude(name, pattern)).toBe(false);

    // matchesExclude: substring match also works
    expect(matchesExclude(name, [pattern])).toBe(true);
  });

  test("pattern priority demonstration", () => {
    // Both use same extension/prefix logic
    expect(matchesInclude("test.ts", "*.ts")).toBe(true);
    expect(matchesExclude("test.ts", ["*.ts"])).toBe(true);

    expect(matchesInclude("test-file", "test-*")).toBe(true);
    expect(matchesExclude("test-file", ["test-"])).toBe(true);

    // But exact patterns differ
    const exact = "node_modules";
    expect(matchesInclude("src/node_modules/file", exact)).toBe(false);
    expect(matchesExclude("src/node_modules/file", [exact])).toBe(true);
  });
});
