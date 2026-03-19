# @obsku/tool-code-interpreter

Local code execution tool for @obsku/framework.

## Installation

```bash
npm install @obsku/tool-code-interpreter
```

## Quick Start

```typescript
import { agent } from "@obsku/framework";
import { codeInterpreter } from "@obsku/tool-code-interpreter";

const assistant = agent({
  name: "assistant",
  prompt: "Write and run small analysis scripts when useful.",
  tools: [codeInterpreter],
});
```

## API Reference

### `codeInterpreter`

Ready-to-use plugin for running Python, JavaScript, and TypeScript in a local subprocess.

### `createCodeInterpreter(options)`

Creates a code interpreter with custom executor or session management.

## Security

### Memory Limits

This tool spawns local subprocesses without memory limits. To enforce limits:

- Run in Docker with `--memory` flag
- Use cgroups on Linux
- Consider containerization for production workloads

### Code Execution Risks

- Executes arbitrary Python/JavaScript/TypeScript code
- Runs with the same permissions as the host process
- **Recommendation**: run in isolated containers for untrusted input

### Sandboxed Alternatives

For stronger isolation:

- **`@obsku/tool-code-interpreter-wasm`**: WASM-sandboxed code execution (no host process access)
- **`@obsku/tool-shell-sandbox`**: Sandboxed shell with InMemoryFs, network off by default


## License

MIT
