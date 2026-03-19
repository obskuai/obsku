# @obsku/tool-search

Search tool set for @obsku/framework.

## Installation

```bash
npm install @obsku/tool-search
```

## Quick Start

```typescript
import { agent } from "@obsku/framework";
import { createSearchTools } from "@obsku/tool-search";

const searchTools = createSearchTools(process.cwd());

const myAgent = agent({
  name: "searcher",
  prompt: "Search files and content.",
  tools: [...Object.values(searchTools)],
});
```

## API Reference

### `createSearchTools(basePath)`

Creates scoped `grep` and `glob` tools for file and content search.

## License

MIT
