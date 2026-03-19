# @obsku/tool-code-interpreter-wasm

WASM sandboxed code interpreter for @obsku/framework.

This package is internal-only. It has large runtime dependencies and is not the recommended public default.

## Installation

```bash
npm install @obsku/tool-code-interpreter-wasm
```

## Quick Start

```typescript
import { agent } from "@obsku/framework";
import { createWasmCodeInterpreter } from "@obsku/tool-code-interpreter-wasm";

const codeInterpreter = createWasmCodeInterpreter();

const assistant = agent({
  name: "assistant",
  prompt: "Use the sandboxed interpreter for small tasks.",
  tools: [codeInterpreter],
});
```

## API Reference

### `createWasmCodeInterpreter(options)`

Creates a code interpreter that runs in a WASM sandbox.

## License

MIT
