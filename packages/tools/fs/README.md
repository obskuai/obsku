# @obsku/tool-fs

Filesystem tool set for @obsku/framework.

## Installation

```bash
npm install @obsku/tool-fs
```

## Quick Start

```typescript
import { agent } from "@obsku/framework";
import { createFsTools } from "@obsku/tool-fs";

const fsTools = createFsTools(process.cwd());

const myAgent = agent({
  name: "file-editor",
  prompt: "Read and edit files.",
  tools: [...Object.values(fsTools)],
});
```

## API Reference

### `createFsTools(basePath)`

Creates file system tools scoped to a base path, including read, write, edit, list, stat, and delete operations.

## License

MIT
