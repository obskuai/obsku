/**
 * Environment variable filtering utilities.
 *
 * Provides blocklist/allowlist filtering for sensitive environment variables
 * like secrets, keys, tokens, and credentials.
 */

/**
 * Default patterns for the blocklist filter.
 * Matches common sensitive environment variable names.
 */
export const DEFAULT_BLOCKLIST_PATTERNS = [
  "*_SECRET*",
  "*_KEY*",
  "*_TOKEN*",
  "*_PASSWORD*",
  "AWS_*",
  "GITHUB_*",
  "ANTHROPIC_*",
  "OPENAI_*",
];

/**
 * Options for environment variable filtering.
 */
export interface EnvFilterOptions {
  /** Filter mode: blocklist excludes matching vars, allowlist includes only matching vars, none disables filtering */
  mode: "blocklist" | "allowlist" | "none";
  /** Custom patterns (glob-style with * wildcards). Defaults to DEFAULT_BLOCKLIST_PATTERNS. */
  patterns?: string[];
  /** Whether to warn when vars are filtered. Defaults to true. */
  warn?: boolean;
}

/**
 * Escapes special regex characters in a string.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Checks if a variable name matches any of the given glob patterns.
 * Patterns support * wildcards and are case-insensitive.
 */
export function matchesPattern(name: string, patterns: string[]): boolean {
  const upperName = name.toUpperCase();
  return patterns.some((pattern) => {
    const upperPattern = pattern.toUpperCase();
    const regex = new RegExp(`^${escapeRegex(upperPattern).replace(/\\\*/g, ".*")}$`);
    return regex.test(upperName);
  });
}

/**
 * Filters environment variables based on blocklist or allowlist patterns.
 *
 * @param env - Environment variables to filter (Record<string, string | undefined>)
 * @param filter - Filter configuration options
 * @param contextName - Name to include in warning messages (e.g., "shell-sandbox", "code-interpreter")
 * @returns Filtered environment variables
 */
export function filterEnvVars(
  env: Record<string, string | undefined> | undefined,
  filter: EnvFilterOptions | undefined,
  contextName: string = "env-filter"
): Record<string, string | undefined> {
  if (!env) {
    return {};
  }

  const effectiveFilter = filter ?? { mode: "blocklist", warn: true };

  if (effectiveFilter.mode === "none") {
    return env;
  }

  const patterns = effectiveFilter.patterns ?? DEFAULT_BLOCKLIST_PATTERNS;
  const result: Record<string, string | undefined> = {};
  const filtered: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }

    const matches = matchesPattern(key, patterns);
    const shouldInclude = effectiveFilter.mode === "allowlist" ? matches : !matches;

    if (shouldInclude) {
      result[key] = value;
      continue;
    }

    if (effectiveFilter.warn !== false) {
      filtered.push(key);
    }
  }

  if (filtered.length > 0 && effectiveFilter.warn !== false) {
    console.warn(`[${contextName}] Filtered env vars: ${filtered.join(", ")}`);
  }

  return result;
}
