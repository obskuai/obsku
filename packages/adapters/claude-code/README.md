# @obsku/adapter-claude-code

Claude Code adapter for `@obsku/framework`.

## Status

Experimental. This package is not positioned as a stable, general-purpose Claude wrapper.

Today it is a thin adapter around the Claude Code CLI with a strict default profile:

- Bash is off by default.
- obsku MCP wiring is on by default.
- Claude permission prompting is wired by default.
- Expansion is explicit and additive only.

## Installation

```bash
npm install @obsku/adapter-claude-code @obsku/framework
```

You also need the `claude` CLI installed and available on `PATH`. The adapter runs `claude` as a subprocess and fails preflight if the binary is missing.

## What it exports

Main entrypoint:

```typescript
import { createClaudeCodePlugin } from "@obsku/adapter-claude-code";
```

The factory returns one normal obsku plugin definition named `claude_code`.

## Quick start

```typescript
import { agent, plugin } from "@obsku/framework";
import { createClaudeCodePlugin } from "@obsku/adapter-claude-code";

const claudeCode = plugin(createClaudeCodePlugin());

const coder = agent({
  name: "coder",
  prompt: "Use Claude Code for bounded repo edits.",
  tools: [claudeCode],
});
```

## Factory usage

```typescript
import { plugin } from "@obsku/framework";
import { createClaudeCodePlugin } from "@obsku/adapter-claude-code";

const claudeCode = plugin(
  createClaudeCodePlugin({
    cwd: "/workspace/app",
    extraTools: ["Bash"],
    extraMcpServers: {
      docs: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace/docs"],
        type: "stdio",
      },
    },
  })
);
```

### Factory config

```typescript
interface ClaudeCodeMcpServerConfig {
  type?: "stdio" | "streamable-http";
  command: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  transport?: "stdio" | "streamable-http";
  url?: string;
}

interface ClaudeCodePluginConfig {
  cwd?: string;
  extraTools?: readonly string[];
  extraMcpServers?: Readonly<Record<string, ClaudeCodeMcpServerConfig>>;
}

declare function createClaudeCodePlugin(
  config?: ClaudeCodePluginConfig,
): PluginDef;
```

`cwd` sets a default working directory for the plugin. Per-call `cwd` still wins.

`extraTools` and `extraMcpServers` are the only public expansion seams.

## Plugin params

`claude_code` accepts these runtime params:

| Param | Type | Required | Notes |
| --- | --- | --- | --- |
| `prompt` | `string` | yes | Instruction passed to Claude Code. |
| `mode` | `"text" | "json"` | no | Output shape selector. Defaults to text behavior when omitted. |
| `schema` | `Record<string, unknown>` | no | JSON schema payload for structured output. Intended for `json` mode. |
| `cwd` | `string` | no | Per-call working directory override. |

## Use examples

### Text mode

```typescript
const result = await claudeCode.run({
  prompt: "Summarize the key files in this package.",
});

// result: string
```

### JSON mode

```typescript
const result = await claudeCode.run({
  mode: "json",
  prompt: "Return package facts as JSON.",
  schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      files: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["name", "files"],
    additionalProperties: false,
  },
});

// result: Record<string, unknown>
```

### Per-call cwd override

```typescript
const result = await claudeCode.run({
  cwd: "/workspace/feature-branch",
  prompt: "Inspect the current package and describe pending edits.",
});
```

## Output contract

The adapter returns the parsed Claude result directly.

- Text mode returns a `string`.
- JSON mode returns an object parsed from Claude's `result` field.

The runner expects Claude CLI JSON envelope output internally, then normalizes it into one of these public shapes:

- `string` for text work
- `Record<string, unknown>` for structured work

If Claude returns malformed JSON, non-object envelopes, or a non-JSON `result` in `json` mode, the adapter throws a typed error.

## Strict defaults

The default profile is strict. Consumers get the bounded baseline without extra flags.

| Surface | Default | Contract |
| --- | --- | --- |
| Bash | off | Bash is not in the default native tool allowlist. |
| Native tools | minimal | Only a curated workspace/file tool set is enabled by default. |
| obsku MCP | on | The adapter wires the default obsku MCP server automatically. |
| Permission seam | on | The adapter wires Claude's `--permission-prompt-tool` path automatically. |
| Expansion | opt-in | Any widening must go through `extraTools` or `extraMcpServers`. |

Default allowed tools:

`Edit`, `Glob`, `Grep`, `LS`, `MultiEdit`, `NotebookEdit`, `NotebookRead`, `Read`, `Task`, `TodoWrite`, `WebFetch`, `Write`

Notably, `Bash` is not included.

## Expansion seams

Only two additive seams exist.

### `extraTools`

- Adds to the default allowlist.
- Does not replace the strict baseline.
- Required for any Bash enablement.
- No wildcard or enable-all mode.

### `extraMcpServers`

- Adds named MCP servers beside the default obsku MCP server.
- Does not disable the default obsku MCP wiring.
- Supports stdio and streamable-http server config.

## Experimental limitations

This package has deliberate limits.

- Experimental, contract may tighten as the adapter matures.
- Depends on the external `claude` CLI being installed and runnable on the host.
- Uses subprocess execution, not an embedded SDK.
- Uses `--no-session-persistence`, so it is intentionally stateless across calls.
- Public config is intentionally narrow. There is no raw CLI arg passthrough.
- No `allowAllTools` style switch.
- No default Bash access.
- No public option to disable the permission seam.
- No public option to replace the default obsku MCP server through the strict config path.
- JSON mode depends on Claude returning valid JSON inside the CLI envelope.
- Default timeout is bounded at `300_000` ms.

## Out of scope for the public API

- Raw `claude -p` flag passthrough
- Raw subprocess arg arrays
- Default Bash access
- Disabling the default permission seam
- Replacing the default obsku MCP server through the strict config path

## License

MIT
