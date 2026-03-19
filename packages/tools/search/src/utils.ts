/**
 * Public surface of search utilities — re-exports from focused modules.
 *
 * Consumers (grep.ts, glob.ts, external) may import from here or from the
 * individual modules directly.
 */

// Framework path-safety helpers
export {
  matchSinglePattern,
  matchesGitignore,
  PathTraversalError,
  parseGitignorePatterns,
  SymlinkEscapeError,
  validatePath,
} from "@obsku/framework/security";

// File filtering: include/exclude patterns + regex escaping
export { escapeRegex, matchesExclude, matchesInclude } from "./file-filter";
// Glob pattern matching and file search
export { globFiles, globMatch } from "./glob-pattern";
// Directory traversal
export type { FindFilesOptions } from "./traversal";
export { findFilesRecursive } from "./traversal";
