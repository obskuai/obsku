# @obsku/tool-code-interpreter-agentcore

AWS Bedrock AgentCore code interpreter for @obsku/framework.

## Installation

```bash
npm install @obsku/tool-code-interpreter-agentcore
```

## Quick Start

```typescript
import { agent } from "@obsku/framework";
import { createAgentCoreCodeInterpreter } from "@obsku/tool-code-interpreter-agentcore";

const codeInterpreter = createAgentCoreCodeInterpreter({
  region: "us-east-1",
});

const assistant = agent({
  name: "assistant",
  prompt: "Run code remotely when needed.",
  tools: [codeInterpreter],
});
```

## API Reference

### `createAgentCoreCodeInterpreter(options)`

Creates a code interpreter plugin backed by AWS Bedrock AgentCore.

## License

MIT
