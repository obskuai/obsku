# @obsku/framework

Effect-powered agent framework with declarative, provider-agnostic API. Consumer code never imports Effect.

## Architecture

### Design Philosophy

- **Effect internal, Promise API**: Consumer uses Promise-based interfaces. Effect powers internal execution for parallel tool dispatch, typed errors, resource management.
- **Provider swappable**: LLM/MCP providers implement simple interfaces. No vendor lock-in.
- **Declarative consumer**: Define agents, plugins, graphs via config objects. No control flow boilerplate.
- **Type-safe events**: Full event streaming with discriminated unions.

### Core Concepts

```
┌─────────────────────────────────────────────────────┐
│  Consumer Code (Promise API)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ agent()  │  │ plugin() │  │ graph()  │          │
│  └──────────┘  └──────────┘  └──────────┘          │
└─────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────┐
│  Framework (Effect Internals)                       │
│  ┌──────────────┐  ┌──────────────┐                │
│  │  Agent Loop  │  │  DAG Graph   │                │
│  │  (ReAct)     │  │  Executor    │                │
│  └──────────────┘  └──────────────┘                │
│  ┌──────────────┐  ┌──────────────┐                │
│  │ LLM Adapter  │  │ EventBus     │                │
│  │ (retry logic)│  │ (PubSub)     │                │
│  └──────────────┘  └──────────────┘                │
└─────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────┐
│  Providers (Swappable)                              │
│  ┌──────────────┐  ┌──────────────┐                │
│  │   Bedrock    │  │  Your Custom │                │
│  │   Provider   │  │   Provider   │                │
│  └──────────────┘  └──────────────┘                │
└─────────────────────────────────────────────────────┘
```

### Internal Module Layout

  - `agent/`: ReAct loop, persistence split across checkpoint, legacy, hooks, mode-selection, plus memory integration and tool dispatch.
  - `graph/`: DAG executor with wave/cycle scheduling, `node-execution/` for agent/function/subgraph nodes, checkpoint context, and restoration.
  - `checkpoint/`: Abstract store contracts, SQL ops, serialization, and migration support.
  - `memory/`: Entity and fact stores, load/save/extract hooks, and vector search.
  - `types/events/`: Domain-split event types across 13 modules.
  - `tool-result-utils/`: Table-driven envelope decoders.
  - `error-utils.ts`: Centralized error normalization.

See `AGENTS.md` at repo root for the authoritative file-level map.

## Usage

### Basic Agent

```typescript
import { agent, plugin, run } from "@obsku/framework"
import { bedrock } from "@obsku/provider-bedrock"

// Define tool
const echo = plugin({
  name: "echo",
  description: "Echo text",
  params: { 
    text: { type: "string", required: true } 
  },
  run: async ({ text }, ctx) => {
    return text
  },
})

// Define agent
const assistant = agent({
  name: "assistant",
  prompt: "You are a helpful assistant. Use tools when needed.",
  tools: [echo],
})

// Run with provider — pass your Bedrock model ID (e.g. anthropic.claude-haiku-4-5-20251001-v1:0)
const result = await assistant.run(
  "Say hello using the echo tool",
  bedrock({ model: "<your-bedrock-model-id>", maxOutputTokens: 4096 })
)
```

### Memory System

Enable automatic memory extraction and context injection for your agents.

#### Features

- **Entity Memory**: Automatically extracts and tracks entities (people, places, IPs, domains, etc.) from agent conversations
- **Long-term Memory**: Saves important facts across sessions for future context
- **Context Injection**: Injects relevant memory into agent prompts automatically

#### Basic Usage

```typescript
import { agent, InMemoryCheckpointStore } from "@obsku/framework";

const store = new InMemoryCheckpointStore();

const myAgent = agent({
  name: "assistant",
  prompt: "You are a helpful assistant.",
  memory: {
    enabled: true,
    store,
    entityMemory: true,       // Extract entities from conversations
    longTermMemory: true,     // Save facts for future sessions
    contextInjection: true,   // Inject memory into prompts
  },
});

await myAgent.run("Remember that example.com is owned by John Doe", provider);
// Later...
await myAgent.run("Who owns example.com?", provider);
// Agent has context: entity "example.com" and fact "owned by John Doe"
```

#### Using a Cheaper Model for Extraction

```typescript
import { bedrock } from "@obsku/provider-bedrock";

const mainProvider = bedrock({ model: "anthropic.claude-opus-4-6-v1", maxOutputTokens: 4096 });
const cheapProvider = bedrock({ model: "anthropic.claude-haiku-4-5-20251001-v1:0", maxOutputTokens: 4096 });

const myAgent = agent({
  // ...
  memory: {
    enabled: true,
    store,
    extractionProvider: cheapProvider,  // Uses Haiku for extraction, Opus for main tasks
  },
});
```

#### Custom Hooks

Override default memory behavior with custom hooks:

```typescript
import { defaultOnMemoryLoad, defaultOnMemorySave, type MemoryHookContext } from "@obsku/framework";

const myAgent = agent({
  // ...
  memory: {
    enabled: true,
    store,
    hooks: {
      // Custom entity extraction
      onEntityExtract: async (ctx: MemoryHookContext) => {
        // Your custom logic here
        return [{ name: "...", type: "...", metadata: {} }];
      },
      
      // Use default for load/save
      onMemoryLoad: defaultOnMemoryLoad,
      onMemorySave: defaultOnMemorySave,
    },
  },
});
```

#### Error Handling

Configure how memory errors are handled:

```typescript
const myAgent = agent({
  // ...
  memory: {
    enabled: true,
    store,
    onHookError: 'log',  // 'throw' | 'log' | 'ignore' (default: 'log')
    errorHandler: (error, hookName) => {
      console.error(`Memory hook ${hookName} failed:`, error);
      // Custom error tracking...
    },
  },
});
```

#### Feature Toggles

Control which memory features are enabled:

```typescript
const myAgent = agent({
  // ...
  memory: {
    enabled: true,
    store,
    entityMemory: true,        // Extract entities during conversation
    longTermMemory: false,     // Don't save facts (session-only)
    contextInjection: true,    // Inject memory context into prompts
    maxEntitiesPerSession: 100,  // Limit entities per session
    maxFactsToInject: 10,        // Limit facts in context
    maxContextLength: 2000,      // Max chars in context string
  },
});
```

### Vector Memory (Semantic Search)

Generate vector embeddings for entities and facts to enable semantic similarity search.

#### Basic Usage

```typescript
import { agent } from "@obsku/framework"
import { OllamaEmbedding } from "@obsku/provider-ollama"

// Create embedding provider
const embeddingProvider = new OllamaEmbedding({
  model: "multilingual-e5-large",  // 1024 dimensions
  dimension: 1024,
  host: "http://localhost:11434",
})

const assistant = agent({
  name: "assistant",
  prompt: "Assistant with semantic search capability",
  memory: {
    enabled: true,
    store,
    entityMemory: true,
    longTermMemory: true,
    contextInjection: true,
    embeddingProvider,  // Enable embedding generation
  },
})

await assistant.run("example.com is owned by John Doe", bedrock({ model: "<your-bedrock-model-id>", maxOutputTokens: 4096 }))
// Embeddings are automatically generated for entities

// Later, search with semantically similar queries
await assistant.run("Who owns example.com?", bedrock({ model: "<your-bedrock-model-id>", maxOutputTokens: 4096 }))
// Semantic search finds relevant entities
```

#### Available Embedding Providers

**Ollama (Local)**:
```typescript
import { OllamaEmbedding } from "@obsku/provider-ollama"

const embeddingProvider = new OllamaEmbedding({
  model: "multilingual-e5-large",  // Default: 1024 dimensions
  dimension: 1024,
  host: "http://localhost:11434",
})
```

**AWS Bedrock**:
```typescript
import { BedrockEmbedding } from "@obsku/provider-bedrock"

const embeddingProvider = new BedrockEmbedding({
  model: "amazon.titan-embed-text-v2:0",  // 1024 dimensions
  region: "us-east-1",
})
```

#### Custom Embedding Provider

Implement the `EmbeddingProvider` interface to create custom providers:

```typescript
import type { EmbeddingProvider } from "@obsku/framework"

class MyEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 768
  readonly modelName = "my-custom-model"

  async embed(text: string): Promise<number[]> {
    // Your embedding generation implementation
    return embeddingVector
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Batch processing implementation
    return texts.map(t => /* embedding */)
  }
}
```

#### How Semantic Search Works

1. **On entity save**: Automatically generates embeddings from name, type, and attributes
2. **On fact save**: Automatically generates embeddings from content
3. **On search**: Compares query embedding and returns most similar results

```typescript
// Direct semantic search on store
const queryEmbedding = await embeddingProvider.embed("web server nginx")
const results = await store.searchEntitiesSemantic(queryEmbedding, {
  topK: 5,        // Top 5 results
  threshold: 0.7, // Similarity >= 0.7
  sessionId: "session-1",
})
```

**Vector Memory Feature Summary**:
| Feature | Description |
|---------|-------------|
| `embeddingProvider` | Embedding generation provider |
| Auto embedding generation | Runs automatically on entity/fact save |
| `searchEntitiesSemantic` | Semantic search for entities |
| `searchFactsSemantic` | Semantic search for facts |
| Backward compatibility | Regular search works without embeddings |

## DX Features

These behaviors are built into the framework and require no extra configuration.

### Auto-serialize Plugin Results

Plugin `run()` can return any value. Strings pass through as-is; everything else is automatically `JSON.stringify`'d before being sent to the LLM. No manual serialization needed.

```typescript
import { plugin } from "@obsku/framework"

const scanSummary = plugin({
  name: "scan_summary",
  description: "Return structured scan results",
  params: { target: { type: "string", required: true } },
  run: async ({ target }) => {
    // Return a plain object — framework serializes it automatically
    return {
      target,
      openPorts: [22, 80, 443],
      os: "Linux",
    }
  },
})
// LLM receives: '{"target":"example.com","openPorts":[22,80,443],"os":"Linux"}'
```

### Auto-catch Plugin Errors

If `run()` throws, the framework catches the error and sends a structured error message back to the LLM instead of crashing the agent loop. The LLM can then decide how to proceed.

```typescript
const riskyTool = plugin({
  name: "risky_tool",
  description: "May fail",
  params: { input: { type: "string", required: true } },
  run: async ({ input }) => {
    // Throwing here does NOT crash the agent
    if (!input) throw new Error("input is required")
    return doWork(input)
  },
})
// On throw, LLM receives: '{"error":"input is required"}'
// Agent loop continues — LLM can retry or recover
```

### providerFactory: Async Provider Resolution

`ServeOptions.providerFactory` accepts a function returning either `LLMProvider` or `Promise<LLMProvider>`. This lets you initialize providers lazily or pick a model per request.

```typescript
import { serve } from "@obsku/agent-server"
import { bedrock } from "@obsku/provider-bedrock"

const server = serve(myAgent, defaultProvider, {
  providerFactory: async (model) => {
    // Resolve provider asynchronously based on requested model
    return bedrock({ model, maxOutputTokens: 4096 })
  },
})
```

### serve() Return Value

`serve()` returns `ReturnType<typeof Bun.serve>`, so you can inspect the bound port, stop the server, or reload routes after startup.

```typescript
import { serve } from "@obsku/agent-server"

const server = serve(myAgent, provider, { port: 0 }) // port 0 = OS-assigned
console.log(`Listening on port ${server.port}`)

// Graceful shutdown
process.on("SIGTERM", () => server.stop())
```

### Compaction Events

When context window management is active, the framework emits `ContextPruned` and `ContextCompacted` events via `onEvent`. Use these to log token savings or update UI.

```typescript
await assistant.run("Long conversation...", provider, {
  onEvent: (event) => {
    if (event.type === "ContextPruned") {
      console.log(`Pruned ${event.removedMessages} messages, saved ~${event.estimatedTokensSaved} tokens`)
    }
    if (event.type === "ContextCompacted") {
      console.log(
        `Compacted ${event.originalMessages} → ${event.compactedMessages} messages,`,
        `saved ~${event.estimatedTokensSaved} tokens`
      )
    }
  },
})
```

### Plugin System

Plugins wrap subprocess execution or API calls with declarative config:

```typescript
import { plugin } from "@obsku/framework"
import { z } from "zod"

export const nmap = plugin({
  name: "nmap",
  description: "Network port scanner",
  params: z.object({
    target: z.string().describe("Target host"),
    ports: z.string().optional().describe("Port range (default: 1-1000)"),
  }),
  run: async ({ target, ports }, ctx) => {
    // ctx provides: exec, signal, logger, fetch
    const result = await ctx.exec(
      "nmap",
      ["-p", ports ?? "1-1000", target],
      { timeout: 30_000, signal: ctx.signal }
    )
    // Return an object — auto-serialized to JSON for the LLM
    return { target, stdout: result.stdout, exitCode: result.exitCode }
  },
})
```

**Key Features**:
- `ctx.exec()`: Subprocess execution with timeout + signal
- `ctx.signal`: Propagates cancellation from framework
- `ctx.logger`: Structured logging
- Automatic param validation
- Object returns auto-serialized to JSON (see [Auto-serialize](#auto-serialize-plugin-results))
- Thrown errors auto-caught and sent to LLM (see [Auto-catch](#auto-catch-plugin-errors))

### Tool Middleware

Tool middleware is the policy layer around tool calls. Use it for logging, caching, mocks, guardrails, deny lists, fallbacks, and result shaping without changing the tool definition.

Global middleware goes on `agent({ toolMiddleware: [...] })`. Tool-local middleware goes on `{ tool, middleware: [...] }` for one tool.

```typescript
import { agent, plugin } from "@obsku/framework"
import { z } from "zod"

const nmap = plugin({
  name: "nmap",
  description: "Network port scanner",
  params: z.object({ target: z.string() }),
  run: async ({ target }) => ({ target, stdout: `scanned ${target}` }),
})

const gobuster = plugin({
  name: "gobuster",
  description: "Directory brute force",
  params: z.object({ target: z.string() }),
  run: async ({ target }) => ({ target, stdout: `enumerated ${target}` }),
})

const loggingMiddleware: ToolMiddleware = async (ctx, next) => {
  console.log(`Calling ${ctx.toolName} with`, ctx.toolInput)
  const result = await next()
  console.log(`${ctx.toolName} returned`, result)
  return result
}

const rateLimitMiddleware: ToolMiddleware = async (ctx, next) => {
  await rateLimiter.check(ctx.toolName)
  return next()
}

const cacheMiddleware: ToolMiddleware = async (ctx, next) => {
  const cached = cache.get(ctx.toolName, ctx.toolInput)
  if (cached) return cached
  const result = await next()
  cache.set(ctx.toolName, ctx.toolInput, result)
  return result
}

const scanner = agent({
  name: "scanner",
  prompt: "Run recon tools with policy guardrails.",
  toolMiddleware: [loggingMiddleware, rateLimitMiddleware],
  tools: [
    nmap,
    { tool: gobuster, middleware: [cacheMiddleware] },
  ],
})
```

Global middleware declared first wraps tool-local middleware. Within each layer, middleware runs in declaration order on the way in and reverse order on the way out (onion model).

```typescript
const outer: ToolMiddleware = async (ctx, next) => {
  console.log("global outer in")
  const result = await next()
  console.log("global outer out")
  return result
}

const inner: ToolMiddleware = async (ctx, next) => {
  console.log("tool local in")
  const result = await next()
  console.log("tool local out")
  return result
}

const ordered = agent({
  name: "ordered",
  prompt: "Show middleware order.",
  toolMiddleware: [outer],
  tools: [{ tool: nmap, middleware: [inner] }],
})

// Call flow:
// 1. outer in
// 2. inner in
// 3. tool executes
// 4. inner out
// 5. outer out
```

#### Short-circuit patterns

Middleware can stop the chain by returning a result and skipping `next()`. That means the real tool never runs.

```typescript
const cacheHitMiddleware: ToolMiddleware = async (ctx, next) => {
  const cached = cache.get(ctx.toolName, ctx.toolInput)
  if (cached) return cached
  const result = await next()
  cache.set(ctx.toolName, ctx.toolInput, result)
  return result
}

const mockMiddleware: ToolMiddleware = async (ctx, next) => {
  if (process.env.MOCK_TOOLS === "1") {
    return { mocked: true, tool: ctx.toolName, input: ctx.toolInput }
  }
  return next()
}

const denyMiddleware: ToolMiddleware = async (ctx, next) => {
  if (ctx.toolInput.target === "localhost") {
    throw new Error("localhost scanning denied by policy")
  }
  return next()
}

const fallbackMiddleware: ToolMiddleware = async (ctx, next) => {
  try {
    return await next()
  } catch {
    return { tool: ctx.toolName, degraded: true, source: "fallback-cache" }
  }
}
```

Middleware can also rewrite input before `next()`. If you change `ctx.toolInput`, the runtime revalidates the rewritten input before the tool runs.

#### Result rewrite

Middleware can inspect the real tool result, transform it, and return the rewritten value to the agent.

```typescript
const redactMiddleware: ToolMiddleware = async (ctx, next) => {
  const result = await next()
  return {
    ...result,
    stdout: redactSecrets(result.stdout),
    audited: true,
  }
}
```

### Graph Orchestration

```typescript
import { graph, run } from "@obsku/framework"
import { bedrock } from "@obsku/provider-bedrock"

const planner = agent({
  name: "planner",
  prompt: "Create scan plan for target",
  tools: [nmap],
})

const executor = agent({
  name: "executor", 
  prompt: "Execute scan plan",
  tools: [nmap, gobuster, httpx],
})

const summarizer = agent({
  name: "summarizer",
  prompt: "Summarize findings",
})

// Define DAG
const pipeline = graph({
  provider: bedrock({ model: "<your-bedrock-model-id>", maxOutputTokens: 4096 }),
  entry: "planner",
  nodes: {
    planner,
    executor,
    summarizer,
  },
  edges: [
    ["planner", "executor"],
    ["executor", "summarizer"],
  ],
})

// Execute graph
const result = await run(pipeline, { 
  input: "Scan example.com",
  onEvent: (event) => console.log(event),
})
```

**Graph Features**:
- **Parallel execution**: Independent nodes run concurrently
- **Typed DAG**: Validates no cycles, orphans, invalid edges
- **Wave-based**: Groups nodes by dependency level
- **Fail-fast**: Node failure interrupts siblings
- **Event streaming**: Real-time progress via EventBus

### Provider Swapping

Switch LLM provider without code changes:

```typescript
import { bedrock } from "@obsku/provider-bedrock"
// import { openai } from "@obsku/provider-openai" (example)

// Use Bedrock
await run(pipeline, { provider: bedrock({ model: "<your-bedrock-model-id>", maxOutputTokens: 4096 }) })

// Switch to OpenAI
// await run(pipeline, { provider: openai() })
```

**Provider Interface**:

```typescript
interface LLMProvider {
  chat(messages: Message[], tools?: ToolDef[]): Promise<LLMResponse>
  chatStream(messages: Message[], tools?: ToolDef[]): AsyncIterable<LLMStreamEvent>
  readonly contextWindowSize: number
}
```

### Context Window Management

Automatic pruning and compaction when conversation grows too large:

```typescript
const assistant = agent({
  name: "assistant",
  prompt: "You are a helpful assistant.",
  contextWindow: { maxContextTokens: 150_000 },
})
```

**ContextWindowConfig**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` if `maxContextTokens` is set, `false` otherwise | Enable context window management. Set `enabled: true` to opt-in using the provider's `contextWindowSize` as the limit. |
| `maxContextTokens` | `number` | `provider.contextWindowSize` | Maximum tokens for context window |
| `pruneThreshold` | `number` | `0.7` | Fraction of maxContextTokens that triggers pruning |
| `compactionThreshold` | `number` | `0.85` | Fraction of maxContextTokens that triggers compaction |
| `compactionStrategy` | `CompactionStrategy` | built-in summarization | Custom compaction strategy |
| `compactionProvider` | `LLMProvider` | agent's provider | Separate LLM for compaction (e.g. cheaper model) |
| `reserveOutputTokens` | `number` | `4096` | Tokens reserved for output |

**Explicit opt-in** (uses provider's `contextWindowSize`):

```typescript
const assistant = agent({
  name: "assistant",
  prompt: "...",
  contextWindow: { enabled: true },
})
await assistant.run("...", bedrock({ model: "...", maxOutputTokens: 4096 }))
```

**Explicit opt-out** (disables even if maxContextTokens set):

```typescript
contextWindow: { enabled: false, maxContextTokens: 100_000 }
```

**Note**: `contextWindow: {}` is inactive — it requires either `maxContextTokens` or `enabled: true`.

## Advanced Features

### Parallel Tool Execution

Agent loop dispatches tools in parallel with configurable concurrency:

```typescript
// Framework config (internal)
const config = {
  toolConcurrency: 3,     // Max parallel tools
  toolTimeout: 30_000,    // Per-tool timeout (ms)
  maxIterations: 10,      // Agent loop limit
}
```

**Behavior**:
- Multiple tool calls in single LLM response → executed in parallel
- Timeout applies per-tool (not total)
- Partial failures: errors returned as results, LLM continues

**Example**:
```
LLM decides: "Run nmap, gobuster, httpx in parallel"
Framework: Executes all 3 concurrently (not sequential)
Result: All 3 complete in max(duration), not sum(duration)
```

### Event System

Subscribe to typed events for UI/logging:

```typescript
await run(pipeline, {
  input: "...",
  onEvent: (event) => {
    switch (event.type) {
      case "agent.thinking":
        console.log(event.content)
        break
      case "stream.chunk":
        process.stdout.write(event.content)
        break
      case "tool.result":
        console.log(`Tool ${event.toolName}: ${event.isError ? "error" : "ok"}`)
        break
      case "graph.node.complete":
        console.log(`Node ${event.nodeId} done`)
        break
    }
  },
})
```

Alternatively, use `agent.subscribe()` for async-iterable event streaming:

```typescript
const events = await myAgent.subscribe({ sessionId: "ses_123" })

// consume in parallel with agent.run()
for await (const event of events) {
  if (event.type === "stream.chunk") process.stdout.write(event.content)
}
```

**Event Types**:
- Agent: `agent.thinking`, `agent.transition`, `agent.error`, `agent.complete`
- Stream: `stream.start`, `stream.chunk`, `stream.end`
- Tool: `tool.call`, `tool.result`, `tool.progress`
- Graph: `graph.node.start`, `graph.node.complete`, `graph.node.failed`, `graph.cycle.start`, `graph.cycle.complete`, `graph.interrupt`

### Error Handling

Framework uses typed errors internally:

```typescript
// LLM errors — single class with discriminant code
class ProviderError {
  code: "throttle" | "auth" | "model" | "network" | "unknown"
  // throttle → auto-retry with exponential backoff
  // auth, model, network, unknown → fail immediately
}

// Plugin errors
class ParamValidationError
class ExecTimeoutError

// Graph errors
class GraphValidationError
```

Consumer sees Promise rejections. Framework handles retry logic internally.

## Testing

Framework provides test utilities:

```typescript
import { MockLLMProvider } from "@obsku/framework/test-utils"

const mockProvider = new MockLLMProvider({
  responses: [
    { 
      role: "assistant", 
      content: [{ type: "text", text: "I'll use the echo tool" }],
      toolCalls: [{ name: "echo", input: { text: "hello" } }],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "Result: hello" }],
      stopReason: "end_turn",
    },
  ],
})

await assistant.run("Test input", mockProvider)
```

## Implementation Notes

### Why Effect Internally?

Effect provides:
- **Parallel execution**: `Effect.all({ concurrency })` for tools/graph nodes
- **Typed errors**: `catchTag` for granular error handling
- **Resource safety**: `acquireRelease` for MCP connections
- **Interruption**: Fiber cancellation propagates to subprocesses
- **Streaming**: `Stream` for LLM responses

Consumer never sees Effect types. Framework encapsulates complexity.

### Why Promise API?

- **Simplicity**: Consumers write standard async/await
- **No Effect knowledge required**: Lower learning curve
- **Ecosystem compatibility**: Works with any TypeScript tooling
- **Provider flexibility**: Providers don't need Effect

### Design Trade-offs

**Chose**:
- Declarative config over imperative control
- Effect internal over exposed Effect
- Type safety over dynamic flexibility
- Explicit providers over global singletons

**Rejected**:
- External agent SDKs (Vercel AI SDK, LangChain) — too opinionated
- Multi-agent swarms — future enhancement

## Checkpoint & Persistence

The framework supports session persistence and checkpointing via the `@obsku/checkpoint` package.

### Basic Checkpointing

```typescript
import { InMemoryCheckpointStore } from "@obsku/checkpoint"
import { graph, run } from "@obsku/framework"

const store = new InMemoryCheckpointStore()

const myGraph = graph({
  provider: bedrock({ model: "<your-bedrock-model-id>", maxOutputTokens: 4096 }),
  entry: "planner",
  nodes: { planner, executor },
  edges: [["planner", "executor"]],
})

// Run with checkpointing
const result = await run(myGraph, {
  input: "Scan example.com",
  checkpointStore: store,
  onCheckpoint: (cp) => console.log("Checkpoint saved:", cp.id),
})
```

### SQLite Persistence

For durable storage across process restarts:

```typescript
import { SqliteCheckpointStore } from "@obsku/checkpoint-sqlite"

const store = new SqliteCheckpointStore("./checkpoints.db")

const result = await run(myGraph, {
  input: "Scan example.com",
  checkpointStore: store,
})

await store.close()
```

### Resume from Checkpoint

```typescript
// Get latest checkpoint for a session
const latest = await store.getLatestCheckpoint(sessionId)

// Resume execution
const result = await run(myGraph, {
  input: "Continue the scan",
  checkpointStore: store,
  sessionId: sessionId,
  resumeFrom: latest,
})
```

### Fork Sessions

Create branches for experimentation. The framework handles checkpointing automatically when you use `run()` with a `checkpointStore`. The `CheckpointBackend` interface (with `saveCheckpoint`) is for backend implementers only—consumers use `CheckpointStore` (read-only) with `run()`:

```typescript
// Fork from the latest checkpoint
const latest = await store.getLatestCheckpoint(session.id)
const forked = await store.fork(latest.id, {
  title: "Experiment: Alternative approach",
})

// Run with forked session - framework handles checkpointing
const result = await run(myGraph, {
  input: "Try alternative approach",
  checkpointStore: store,
  sessionId: forked.id,
})
```

> **Note:** `CheckpointBackend` extends `CheckpointStore` with `saveCheckpoint()` for backend implementers. Consumers use `run()` which manages checkpointing internally.

### Helper Utilities

```typescript
import { CheckpointStoreHelpers } from "@obsku/checkpoint"

const helpers = new CheckpointStoreHelpers(store)

// Resume most recent session
const latest = await helpers.continueLatest(workspaceId)

// Search sessions
const matches = await helpers.searchSessions("security scan")

// Get session summary
const summary = await helpers.getSessionSummary(sessionId)
```

## Production Features (P10)

### Human-in-the-Loop

Pause agent execution and resume with user input:

```typescript
import { interrupt, resumeGraph, run } from "@obsku/framework"

// In a node function
function reviewNode() {
  const findings = analyzeTarget()
  if (needsReview(findings)) {
    interrupt({
      reason: "Security findings require human review",
      requiresInput: true,
    })
  }
  return findings
}

// Resume later
const checkpoint = await store.getLatestCheckpoint(sessionId)
const result = await resumeGraph(myGraph, checkpoint.id, store, userDecision)
```

### Multi-Agent Patterns

#### Supervisor Pattern

Coordinator delegates tasks to specialized workers:

```typescript
import { supervisor, agent } from "@obsku/framework"

const coordinator = supervisor({
  provider: myProvider,
  name: "coordinator",
  workers: [
    agent({ name: "researcher", prompt: "Research the target" }),
    agent({ name: "analyzer", prompt: "Analyze findings" }),
  ],
  maxRounds: 5,
})

// Supervisor returns: { next: "researcher" | "analyzer" | "FINISH" }
const result = await run(coordinator)
```

#### Crew Pattern

Sequential or hierarchical task execution:

```typescript
import { crew } from "@obsku/framework"

const scanCrew = crew({
  provider: myProvider,
  name: "security-scan",
  process: "sequential",
  members: [
    { agent: reconAgent, task: "Perform reconnaissance" },
    { agent: vulnAgent, task: "Identify vulnerabilities" },
    { agent: reportAgent, task: "Generate report" },
  ],
})
```

### Agent Factory (Dynamic Sub-Agents)

Enable agents to dynamically create and execute specialized sub-agents at runtime:

```typescript
const explorer = agent({
  name: "explorer",
  prompt: "You explore datasets and delegate to specialists.",
  tools: [sqlTool],
  agentFactory: true, // adds create_agent, call_agent, execute_agent tools
})

// The LLM can now:
// 1. execute_agent — one-shot: create + run + discard in a single call
// 2. create_agent — persist a specialist for repeated calls
// 3. call_agent — invoke a previously created agent
```

**One-shot (recommended for most cases):**
The LLM calls `execute_agent({ prompt: "You are a SQL expert...", task: "Write a query for...", tools: ["sql"] })` — creates an ephemeral agent, runs it, returns the result. No persistence.

**Multi-turn (reusable agents):**
The LLM calls `create_agent({ name: "sql-expert", prompt: "..." })` then later `call_agent({ name: "sql-expert", task: "..." })` across multiple turns.

**Configuration:**
```typescript
agentFactory: {
  maxDepth: 5,      // nesting limit (default: 5)
  maxAgents: 10,    // max created agents (default: 10)
  allowedChildTools: ["sql"], // restrict child tool access
}
```

**Safety:** Depth protection via AsyncLocalStorage, error isolation (child errors return JSON, never crash parent), max agents limit.

### OpenTelemetry Integration

Automatic instrumentation for observability:

```typescript
import { setupTelemetry, shutdownTelemetry } from "@obsku/framework"

await setupTelemetry({
  serviceName: "obsku-agent",
  enabled: true,
  exporter: "otlp",
  endpoint: "http://localhost:4318",
})

// Run agents - traces automatically exported
await run(myGraph)

await shutdownTelemetry()
```

Spans created automatically for:
- LLM calls (`llm.call` with `gen_ai.*` attributes)
- Tool executions (`tool.execute` with `tool.name`)
- Checkpoint operations (`checkpoint.save`, `checkpoint.load`, `checkpoint.fork`)

### Distributed Checkpoint Stores

Redis and PostgreSQL backends for production:

```typescript
// Redis (distributed, in-memory)
import { RedisCheckpointStore } from "@obsku/checkpoint-redis"
const redisStore = new RedisCheckpointStore({ url: process.env.REDIS_URL })

// PostgreSQL (durable, SQL)
import { PostgresCheckpointStore } from "@obsku/checkpoint-postgres"
const pgStore = new PostgresCheckpointStore(process.env.POSTGRES_URL!)
await pgStore.setup()

// Use with framework
await run(myGraph, { checkpointStore: redisStore, sessionId })
```

See:
- [@obsku/checkpoint-redis](../checkpoint-redis/README.md)
- [@obsku/checkpoint-postgres](../checkpoint-postgres/README.md)

## Related Packages

- `@obsku/provider-bedrock`: AWS Bedrock LLM provider
- `@obsku/checkpoint-redis`: Redis checkpoint store (distributed)
- `@obsku/checkpoint-postgres`: PostgreSQL checkpoint store (durable)

## Configuration Reference

### Environment Variables

These environment variables control runtime behavior. Set them before starting your process.

| Setting | Environment Variable | Default | Description |
|---------|---------------------|---------|-------------|
| Tool Concurrency | `OBSKU_TOOL_CONCURRENCY` | `3` | Max parallel tool executions per agent turn |
| Tool Timeout | `OBSKU_TOOL_TIMEOUT` | `30000` (30s) | Per-tool execution timeout in milliseconds |
| Max Iterations | `OBSKU_MAX_ITERATIONS` | `10` | Agent loop iteration limit before forced stop |

### Framework Constants

Internal constants used across the framework. Not configurable at runtime, but useful for understanding default behavior.

| Constant | Value | Description |
|----------|-------|-------------|
| `DEFAULT_TOOL_TIMEOUT_MS` | `30000` (30s) | Default tool timeout, used when `OBSKU_TOOL_TIMEOUT` is unset |
| `DEFAULT_THINKING_BUDGET_TOKENS` | `4096` | Thinking budget for LLM providers with extended thinking |
| `RESERVE_OUTPUT_TOKENS` | `4096` | Tokens reserved for output in context window management |
| `MS_PER_SECOND` | `1000` | Conversion constant for ms/seconds |

### Default Values

Key defaults from `DEFAULTS` used throughout the framework.

| Setting | Default | Description |
|---------|---------|-------------|
| EventBus capacity | `1024` | Internal event bus buffer size |
| Tool timeout | `30,000` ms (30s) | Tool execution timeout |
| Graph node timeout | `300,000` ms (5m) | Max time for a single graph node |
| Exec command timeout | `30,000` ms (30s) | Subprocess execution timeout |
| Background task lifetime | `300,000` ms (5m) | Max lifetime for background tasks |
| Background task retention | `60,000` ms (60s) | How long completed tasks are retained |
| Remote agent timeout | `300,000` ms (5m) | HTTP/ARN call timeout for remote agents |
| Prune threshold | `0.7` | Fraction of max context tokens that triggers pruning |
| Compaction threshold | `0.85` | Fraction of max context tokens that triggers compaction |
| Protected recent pairs | `3` | Recent message pairs protected during pruning |
| Compaction recent buffer | `4` | Recent messages preserved during compaction |
| Preserve system messages | `true` | Keep system messages during compaction |
| Memory: max context length | `2000` chars | Max character length for injected memory context |
| Memory: max entities/session | `100` | Entity cap per session |
| Memory: max facts to inject | `10` | Facts injected into agent context |
| Memory: min fact confidence | `0.7` | Threshold for fact inclusion |
| Memory: default confidence | `0.5` | Default confidence for new facts |
| Memory: semantic threshold | `0.7` | Cosine similarity threshold for semantic search |
| AgentCore server port | `8080` | Default port for AgentCore protocol |
| A2A server port | `9000` | Default port for A2A protocol |
| MCP server port | `3000` | Default port for MCP protocol |
| Agent factory max iterations | `10` | Iteration limit for dynamically created sub-agents |
| Tool output truncation ratio | `0.05` | Fraction of context window for tool output truncation |


## Security Considerations

Agents can execute arbitrary code and shell commands. Treat every agent deployment as a potential remote-code-execution surface.

### Shell and Code Execution

- Tools that call `ctx.exec()` spawn real subprocesses. Never expose these to untrusted input without validation.
- Set `toolTimeout` to bound execution time. The framework's default is 30 seconds per tool.
- Use `@obsku/shell-sandbox` or `@obsku/code-interpreter` for sandboxed execution. See their READMEs for memory limits, network isolation, and filesystem risks.

### Environment Variable Filtering

Both `shell-sandbox` and `code-interpreter` support `envFilter` with three modes:

- **`blocklist`** (default): Strips vars matching sensitive patterns (`*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `AWS_*`, etc.). Warns on removal.
- **`allowlist`**: Only passes vars matching explicit patterns (e.g. `PUBLIC_*`).
- **`none`**: Disables filtering. Use only when the subprocess is fully trusted.

Always review the default blocklist patterns before deploying to production.

### Filesystem Isolation

- **InMemoryFs** (default in shell-sandbox): Fully isolated virtual filesystem. Recommended for untrusted code.
- **OverlayFs**: Mounts a real host directory as a read layer. Symlink escape is possible if the overlay base contains symlinks pointing outside the sandbox root. Audit overlay contents or stick with InMemoryFs for untrusted workloads.

See [`@obsku/shell-sandbox` README](../tools/shell-sandbox/README.md) for full details.

### Containerization

For production deployments:

- Run agents inside containers with a read-only root filesystem.
- Drop all capabilities except those explicitly needed.
- Use network policies to restrict outbound traffic from agent containers.
- Mount scratch space as a tmpfs with a size limit.
- Never run agent processes as root.

### Request Body Size Limits

`@obsku/agent-server` enforces a 1 MB request body limit by default (configurable via `maxBodySize`). This prevents memory exhaustion from oversized payloads. If you run a custom server, apply equivalent limits at the HTTP layer.


## License

MIT
