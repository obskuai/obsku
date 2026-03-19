export { type GlobEntry, type GlobResult, glob } from "./glob";
export { type GrepMatch, type GrepResult, grep } from "./grep";
export {
  escapeRegex,
  globMatch,
  matchSinglePattern,
  matchesExclude,
  matchesGitignore,
  matchesInclude,
  PathTraversalError,
  SymlinkEscapeError,
  validatePath,
} from "./utils";

import { glob } from "./glob";
import { grep } from "./grep";

export function createSearchTools(basePath: string) {
  return {
    glob: glob(basePath),
    grep: grep(basePath),
  };
}
