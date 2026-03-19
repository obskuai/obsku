# @obsku/provider-bedrock

AWS Bedrock provider for @obsku/framework.

## Installation

```bash
npm install @obsku/provider-bedrock
```

## Quick Start

```typescript
import { agent } from "@obsku/framework";
import { bedrock } from "@obsku/provider-bedrock";

const provider = await bedrock({
  model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
  region: "us-east-1",
});

const assistant = agent({
  name: "assistant",
  prompt: "You are a helpful assistant.",
});

const result = await assistant.run("Summarize this finding", provider);
```

## API Reference

### `bedrock(config)`

Creates an AWS Bedrock LLM provider for use with `@obsku/framework`.

## License

MIT
