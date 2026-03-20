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

Automatic memory extraction and context injection.

- **Entity Memory**: Extracts and tracks entities (people, IPs, domains) from conversations
- **Long-term Memory**: Saves facts across sessions
- **Context Injection**: Injects relevant memory into agent prompts

```typescript
import { agent, InMemoryCheckpointStore } from "@obsku/framework";

const store = new InMemoryCheckpointStore();

const myAgent = agent({
  name: "assistant",
  prompt: "You are a helpful assistant.",
  memory: {
    enabled: true,
    store,
    entityMemory: true,
    longTermMemory: true,
    contextInjection: true,
    // extractionProvider: cheapProvider  // optional: use cheaper model for extraction
  },
});

await myAgent.run("Remember that example.com is owned by John Doe", provider);
await myAgent.run("Who owns example.com?", provider);
// Agent has context: entity "example.com" and fact "owned by John Doe"
```

`onHookError: 'throw' | 'log' | 'ignore'` (default: `'log'`)

### Vector Memory (Semantic Search)

Add `embeddingProvider` to the memory config to enable semantic similarity search.

```typescript
import { agent } from "@obsku/framework"
import { OllamaEmbedding } from "@obsku/provider-ollama"

const assistant = agent({
  name: "assistant",
  prompt: "Assistant with semantic search",
  memory: {
    enabled: true,
    store,
    entityMemory: true,
    longTermMemory: true,
    contextInjection: true,
    embeddingProvider: new OllamaEmbedding({
      model: "multilingual-e5-large",
      dimension: 1024,
      host: "http://localhost:11434",
    }),
  },
})
```

| Feature | Description |
|---------|-------------|
| `embeddingProvider` | Embedding generation provider |
| Auto embedding generation | Runs automatically on entity/fact save |
| `searchEntitiesSemantic` | Semantic search for entities |
| `searchFactsSemantic` | Semantic search for facts |
| Backward compatibility | Regular search works without embeddings |

Embedding providers: `@obsku/provider-ollama` (OllamaEmbedding), `@obsku/provider-bedrock` (BedrockEmbedding). Implement `EmbeddingProvider` for custom providers.

## DX Features

These behaviors are built into the framework and require no extra configuration.

### Auto-serialize Plugin Results

Plugin `run()` can return any value. Strings pass through; objects are auto-`JSON.stringify`'d.

```typescript
const scanSummary = plugin({
  name: "scan_summary",
  description: "Return structured scan results",
  params: { target: { type: "string", required: true } },
  run: async ({ target }) => ({ target, openPorts: [22, 80, 443], os: "Linux" }),
})
// LLM receives: '{"target":"example.com","openPorts":[22,80,443],"os":"Linux"}'
```

### Auto-catch Plugin Errors

If `run()` throws, the framework sends a structured error to the LLM instead of crashing.

```typescript
const riskyTool = plugin({
  name: "risky_tool",
  description: "May fail",
  params: { input: { type: "string", required: true } },
  run: async ({ input }) => {
    if (!input) throw new Error("input is required")
    return doWork(input)
  },
})
// On throw, LLM receives: '{"error":"input is required"}' — agent loop continues
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

`serve()` returns `ReturnType<typeof Bun.serve>`. Use `server.port`, `server.stop()`, etc.

### Compaction Events

Framework emits `ContextPruned` and `ContextCompacted` events via `onEvent` when context window management triggers. Listen for them to log token savings.

### Plugin System

Plugins wrap subprocess execution or API calls with declarative config. `ctx` provides `exec`, `signal`, `logger`, `fetch`.

```typescript
const nmap = plugin({
  name: "nmap",
  description: "Network port scanner",
  params: z.object({
    target: z.string().describe("Target host"),
    ports: z.string().optional().describe("Port range"),
  }),
  run: async ({ target, ports }, ctx) => {
    const result = await ctx.exec("nmap", ["-p", ports ?? "1-1000", target], { timeout: 30_000 })
    return { target, stdout: result.stdout, exitCode: result.exitCode }
  },
})
```
### Tool Middleware

Policy layer around tool calls for logging, caching, mocks, guardrails, and result shaping. Middleware wraps tool execution without changing tool definitions.

Global middleware: `agent({ toolMiddleware: [...] })`. Per-tool: `{ tool, middleware: [...] }`. Global wraps local (onion model).

```typescript
const loggingMiddleware: ToolMiddleware = async (ctx, next) => {
  console.log(`Calling ${ctx.toolName} with`, ctx.toolInput)
  const result = await next()
  console.log(`${ctx.toolName} returned`, result)
  return result
}

const scanner = agent({
  name: "scanner",
  prompt: "Run tools with policy guardrails.",
  toolMiddleware: [loggingMiddleware],
  tools: [nmap, { tool: gobuster, middleware: [cacheMiddleware] }],
})
```

**Common patterns**: cache (return early, skip `next()`), mock (return fake data in test), deny (throw on forbidden input), fallback (catch errors, return degraded result), input rewrite (mutate `ctx.toolInput` before `next()`), result rewrite (transform result after `next()`)

### Graph Orchestration

Graph nodes can be **agents** (LLM-powered) or **plain functions** (deterministic, no LLM). Mix freely.

```typescript
import { graph, run } from "@obsku/framework"
import { bedrock } from "@obsku/provider-bedrock"

const provider = bedrock({ model: "<model-id>", maxOutputTokens: 4096 })

// Function node — deterministic, no LLM cost
const validate = {
  id: "validate",
  executor: async (input: string) => {
    const data = JSON.parse(input)
    if (!data.target) throw new Error("missing target")
    return JSON.stringify(data)
  },
}

// Agent nodes — LLM-powered
const planner = agent({ name: "planner", prompt: "Create scan plan", tools: [nmap] })
const executor = agent({ name: "executor", prompt: "Execute plan", tools: [nmap, gobuster] })

const pipeline = graph({
  provider,
  entry: "validate",
  nodes: [validate, planner, executor],
  edges: [
    { from: "validate", to: "planner" },
    { from: "planner", to: "executor" },
  ],
})

await run(pipeline, { input: '{"target":"example.com"}' })
```

**Practical patterns**:
- **Preprocessing → agent**: validate/transform input before LLM sees it
- **Agent → postprocessing**: format, filter, or redact agent output
- **Cyclic refinement**: `back: true` edges with `maxIterations` for iterative loops
- **Subgraphs**: nest a `graph()` inside another graph as a node

**Graph features**: parallel wave execution, cycle detection, checkpoint integration, fail-fast, typed events

### Provider Swapping

Switch LLM provider without code changes:

```typescript
import { bedrock } from "@obsku/provider-bedrock"
await run(pipeline, { provider: bedrock({ model: "<model-id>", maxOutputTokens: 4096 }) })
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

`contextWindow: { enabled: true }` opts in using the provider's `contextWindowSize`. `contextWindow: {}` alone is inactive.

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

Tools called in a single LLM response run in parallel. Timeout applies per-tool. Partial failures return as error results; the agent loop continues.

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

Also available: `agent.subscribe()` returns an `AsyncIterable` of events for streaming consumption.

**Event Types**:
- Agent: `agent.thinking`, `agent.transition`, `agent.error`, `agent.complete`
- Stream: `stream.start`, `stream.chunk`, `stream.end`
- Tool: `tool.call`, `tool.result`, `tool.progress`
- Graph: `graph.node.start`, `graph.node.complete`, `graph.node.failed`, `graph.cycle.start`, `graph.cycle.complete`, `graph.interrupt`

### Error Handling

Framework uses typed errors internally:

```typescript
class ProviderError {
  code: "throttle" | "auth" | "model" | "network" | "unknown"
  // throttle → auto-retry with backoff; others → fail immediately
}
// Also: ParamValidationError, ExecTimeoutError, GraphValidationError
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
const result = await run(myGraph, { input: "Scan example.com", checkpointStore: store })
```

### Resume from Checkpoint

```typescript
const latest = await store.getLatestCheckpoint(sessionId)
const result = await run(myGraph, {
  input: "Continue",
  checkpointStore: store,
  sessionId,
  resumeFrom: latest,
})
```

Fork sessions: `store.fork(checkpointId, { title })` creates a branch for experimentation. See `CheckpointStoreHelpers` for convenience methods (`continueLatest`, `searchSessions`, `getSessionSummary`).

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

Auto-instrumented spans for LLM calls, tool executions, and checkpoint operations.
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

See `src/defaults.ts` for all default values.

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

### Request Body Size Limits

`@obsku/agent-server` enforces a 1 MB request body limit by default (configurable via `maxBodySize`). This prevents memory exhaustion from oversized payloads. If you run a custom server, apply equivalent limits at the HTTP layer.


## License

MIT
