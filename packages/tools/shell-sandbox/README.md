# @obsku/tool-shell-sandbox

Sandboxed shell execution tool using just-bash for @obsku/framework.

## Installation

```bash
npm install @obsku/tool-shell-sandbox
```

## Quick Start

```typescript
import { agent } from "@obsku/framework";
import { sandboxedExec } from "@obsku/tool-shell-sandbox";

const myAgent = agent({
  name: "sandbox-runner",
  prompt: "Run shell commands in a sandbox.",
  tools: [sandboxedExec],
});
```

## API Reference

### `sandboxedExec`

Default plugin for running sandboxed shell commands using just-bash (InMemoryFs, network off).

### `createSandboxedExec(options)`

Factory for creating a sandboxed exec plugin with custom options:

```typescript
import { createSandboxedExec } from "@obsku/tool-shell-sandbox";

const customExec = createSandboxedExec({
  fs: "overlay",  // "memory" (default) | "overlay"
  timeout: 10_000,
  network: { enabled: true, allowedUrlPrefixes: ["https://api.example.com/"] },
});
```

## Security

### Memory Limits

just-bash doesn't provide a memory limit API. To cap memory consumption:

- Run in Docker with `--memory` flag (e.g., `docker run --memory=512m ...`)
- Use cgroups on Linux: `systemd-run --property=MemoryMax=512M ...`

### OverlayFs Risks

When using `OverlayFs` (via `fs: "overlay"`):

- Symlinks pointing outside the overlay may escape the sandbox
- Malicious scripts could follow symlinks to read host files
- **Recommendation**: prefer `InMemoryFs` (default) for untrusted code, or audit overlay contents carefully

### Network Access

Network access is disabled by default. Enable with `network: { enabled: true, allowedUrlPrefixes: [...] }`.


## License

MIT
