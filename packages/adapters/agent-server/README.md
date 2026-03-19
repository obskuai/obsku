# @obsku/adapter-agent-server

A2A and AgentCore HTTP server adapter for @obsku/framework.

## Installation

```bash
npm install @obsku/adapter-agent-server
```

## Quick Start

```typescript
import { agent } from "@obsku/framework";
import { serve } from "@obsku/adapter-agent-server";
import { bedrock } from "@obsku/provider-bedrock";

const assistant = agent({
  name: "assistant",
  prompt: "You are a helpful assistant.",
});

const provider = await bedrock({
  model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
  region: "us-east-1",
});

serve(assistant, provider, { port: 3000, protocol: "a2a" });
```

## API Reference

### `serve(agent, provider, options)`

Starts an HTTP server for A2A or AgentCore-compatible requests.

## Internal Structure

- `handler-utils.ts` — shared run/stream orchestration (protocol-neutral)
- `a2a-handler.ts` — A2A protocol adapter (thin, delegates to handler-utils)
- `agentcore-handler.ts` — AgentCore protocol adapter (thin, delegates to handler-utils)
- `parse-request.ts` — request decoding/validation
- `shared.ts` — SSE formatting primitives

## License

MIT
