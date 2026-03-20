/**
 * File inclusion/exclusion matching utilities.
 *
 * Delegates single-pattern matching to matchSinglePattern (framework/security),
 * which is the shared owner of glob-style pattern semantics:
 *   *.ext  — suffix match
 *   prefix*  — prefix match
 *   name  — exact match (exclude also does substring match for directory names)
 */
import { matchSinglePattern } from "@obsku/framework/security";
import { escapeRegex } from "@obsku/framework";
export { escapeRegex };

/** Returns true if `name` matches the include `pattern`. */
export function matchesInclude(name: string, pattern: string): boolean {
  return matchSinglePattern(name, pattern, false);
}

/** Returns true if `name` matches any of the exclude `patterns`. */
export function matchesExclude(name: string, patterns: Array<string>): boolean {
  return patterns.some((pattern) => matchSinglePattern(name, pattern, true));
}
