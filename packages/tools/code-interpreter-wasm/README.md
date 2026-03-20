# @obsku/tool-code-interpreter-wasm

WASM-sandboxed code interpreter for @obsku/framework. Runs Python (via Pyodide) and JavaScript (via QuickJS) in a WebAssembly sandbox with no host process access.


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
