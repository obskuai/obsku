# Obsku


Obsku is a **plugin-first agent framework** built with **TypeScript + Effect**.
The core engine is UI‑agnostic; Web/API adapters consume the same event stream.

## Architecture

```
packages/
  framework/          # @obsku/framework - Effect-powered agent framework
  ├── agent/          # ReAct loop with parallel tool execution
  ├── graph/          # DAG orchestrator with wave-based parallelism
  ├── interrupt/      # Human-in-the-loop (pause/resume)
  ├── multi-agent/    # Supervisor & Crew DSL
  ├── memory/         # Entity & long-term memory with hooks + vector search
  ├── checkpoint/     # Session persistence & checkpointing (InMemory store)
  ├── embeddings/     # EmbeddingProvider interface
  ├── telemetry/      # OpenTelemetry instrumentation
  └── types.ts        # Provider interfaces, plugin types
  
  checkpoint-sqlite/  # @obsku/checkpoint-sqlite - SQLite storage backend
  checkpoint-redis/   # @obsku/checkpoint-redis - Redis storage backend
  checkpoint-postgres/# @obsku/checkpoint-postgres - PostgreSQL storage backend
  benchmark/          # @obsku/benchmark - internal benchmark platform
  cli/                # @obsku/cli - CLI dispatcher
  
  providers/
    ai-sdk/          # @obsku/provider-ai-sdk - Vercel AI SDK adapter (OpenAI/Anthropic/Google/Groq)
    bedrock/          # @obsku/provider-bedrock - AWS Bedrock LLM + Embedding provider
    ollama/           # @obsku/provider-ollama - Ollama Embedding provider (local)
  
  adapters/           # Web / API (consume EventBus)
    agent-server/     # Agent server adapter
    claude-code/      # Claude Code adapter

  tools/              # Tool packages
    shell/            # Shell tool
    shell-sandbox/    # Sandboxed shell tool
    fs/               # Filesystem tool
    search/           # Search tool
    code-interpreter/ # Code interpreter tool
    code-interpreter-wasm/      # WASM code interpreter
    code-interpreter-agentcore/ # AgentCore code interpreter
```

## Key Features

### Core
- **Declarative API**: Define agents, plugins, graphs via config objects
- **Effect-agnostic consumer**: Consumer code never imports Effect (Promise-based API)
- **Swappable providers**: LLM/MCP providers implement simple interfaces
- **Parallel execution**: Tools and graph nodes run concurrently with configurable limits
- **Type-safe events**: Full event streaming for UI/logging
- **Resource safety**: Automatic cleanup, timeout handling, interruption propagation

### Graph Orchestration
- **Cyclic graphs**: Back-edges with `maxIterations` for iterative refinement loops
- **Subgraphs**: Hierarchical graph composition (Graph-in-Graph nesting)
- **Dynamic prompts**: Context-aware prompt generation at runtime
- **Agent hooks**: `beforeLLMCall`/`afterLLMCall` lifecycle callbacks
- **Provider wrapper**: `wrapProvider()` for LLM call interception

### Production Features (P10)
- **Human-in-the-Loop**: `interrupt()` / `resumeGraph()` for pause/resume workflows
- **Multi-Agent DSL**: `supervisor()` and `crew()` for coordination patterns
- **OpenTelemetry**: Auto-instrumentation for LLM calls, tools, checkpoints
- **Distributed Storage**: Redis and PostgreSQL checkpoint backends
- **Checkpointing**: Session persistence with time-travel and fork/branch support

### Memory System (P11)
- **Entity Memory**: Auto-extract entities (people, domains, IPs) from conversations
- **Long-term Memory**: Persist facts across sessions for future context
- **Context Injection**: Inject relevant memory into agent prompts automatically
- **Memory Hooks**: `onMemoryLoad`, `onEntityExtract`, `onMemorySave` lifecycle
- **Storage Backends**: All checkpoint stores support MemoryStore interface
- **Cost Optimization**: Separate `extractionProvider` for cheaper extraction models

### Vector Memory (P12)
- **Embedding Providers**: Pluggable `EmbeddingProvider` interface (Bedrock Titan v2, Ollama multilingual-e5)
- **Semantic Search**: `searchEntitiesSemantic` / `searchFactsSemantic` with cosine similarity
- **Auto-Embedding**: Memory hooks auto-generate embeddings when provider configured
- **Backward Compatible**: Opt-in — works without embeddings, falls back to regular search

## Quick Start

```typescript
import { agent, graph, run, plugin } from "@obsku/framework"
import { bedrock } from "@obsku/provider-bedrock"

const provider = bedrock({ model: "<model-id>", maxOutputTokens: 4096 })

// 1. Simple agent
const assistant = agent({ name: "assistant", prompt: "You are helpful." })
await assistant.run("Hello!", provider)

// 2. Graph with agent + function nodes
const pipeline = graph({
  provider,
  entry: "validate",
  nodes: [
    { id: "validate", executor: async (input) => JSON.parse(input) },  // function node (no LLM)
    agent({ name: "analyze", prompt: "Analyze the data" }),             // agent node (LLM)
  ],
  edges: [{ from: "validate", to: "analyze" }],
})
await run(pipeline, { input: '{"target":"example.com"}' })
```

See [`packages/framework/README.md`](./packages/framework/README.md) for full documentation.

## Status

**Current**: Framework P12 complete. 3182 pass 0 fail (232 skip).
APIs stabilizing, not yet 1.0.

## Safety
Authorized security testing only.
