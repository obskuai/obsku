export { deleteFile } from "./delete-file";
export { editFile } from "./edit-file";
export { listDir } from "./list-dir";
export { readFile } from "./read-file";
export { stat } from "./stat";
export { PathTraversalError, SymlinkEscapeError, validatePath } from "./utils";
export { writeFile } from "./write-file";

import { deleteFile } from "./delete-file";
import { editFile } from "./edit-file";
import { listDir } from "./list-dir";
import { readFile } from "./read-file";
import { stat } from "./stat";
import { writeFile } from "./write-file";

export function createFsTools(basePath: string) {
  return {
    deleteFile: deleteFile(basePath),
    editFile: editFile(basePath),
    listDir: listDir(basePath),
    readFile: readFile(basePath),
    stat: stat(basePath),
    writeFile: writeFile(basePath),
  };
}
