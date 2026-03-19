# @obsku/tool-shell

Shell execution tool for @obsku/framework.

## Installation

```bash
npm install @obsku/tool-shell
```

## Quick Start

```typescript
import { agent } from "@obsku/framework";
import { exec } from "@obsku/tool-shell";

  const myAgent = agent({
  name: "shell-runner",
  prompt: "Run shell commands.",
  tools: [exec],
});
```

## API Reference

### `exec`

Plugin for running shell commands with timeout and execution controls.

## License

MIT
