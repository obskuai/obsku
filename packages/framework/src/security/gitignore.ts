export function parseGitignorePatterns(content: string): Array<string> {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"));
}

/**
 * Test whether `name` matches a single glob-style `pattern`.
 *
 * Pattern rules:
 *   `*anything`  — suffix match (name ends with `anything`)
 *   `prefix*`    — prefix match (name starts with `prefix`)
 *   `bare`       — exact match; or exact + substring when `substringFallback` is true
 *
 * Ownership note: this is the shared core used by both matchesGitignore (framework)
 * and matchesExclude (search). The only semantic difference between callers is the
 * bare-pattern fallback: gitignore uses exact-only, exclude uses substring.
 */
export function matchSinglePattern(
  name: string,
  pattern: string,
  substringFallback = false
): boolean {
  if (pattern.startsWith("*")) {
    return name.endsWith(pattern.slice(1));
  }
  if (pattern.endsWith("*")) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return substringFallback ? name === pattern || name.includes(pattern) : name === pattern;
}

export function matchesGitignore(name: string, isDir: boolean, patterns: Array<string>): boolean {
  for (const pattern of patterns) {
    const cleanPattern = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
    const dirOnly = pattern.endsWith("/");

    if (dirOnly && !isDir) {
      continue;
    }

    if (matchSinglePattern(name, cleanPattern)) {
      return true;
    }
  }
  return false;
}
