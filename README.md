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
import { agent, plugin, graph, run } from "@obsku/framework"
import { bedrock } from "@obsku/provider-bedrock"

// Define agent
const assistant = agent({
  name: "assistant",
  prompt: "You are a helpful assistant.",
})

// Run agent
const result = await assistant.run("Hello!", bedrock({ model: "<your-bedrock-model-id>", maxOutputTokens: 4096 }))

// With checkpointing (session persistence)
import { SqliteCheckpointStore } from "@obsku/checkpoint-sqlite"

const store = new SqliteCheckpointStore("./sessions.db")
const session = await store.createSession("./project")

await run(myGraph, {
  input: "Scan example.com",
  checkpointStore: store,
  sessionId: session.id,
})

// Resume from checkpoint (time-travel)
const checkpoint = await store.getLatestCheckpoint(session.id)
await run(myGraph, { ..., resumeFrom: checkpoint })

// With memory (entity extraction + long-term facts)
const memoryAgent = agent({
  name: "assistant",
  prompt: "You are a helpful assistant.",
  memory: {
    enabled: true,
    store,
    entityMemory: true,      // Extract entities from conversations
    longTermMemory: true,    // Save facts across sessions
    contextInjection: true,  // Inject memory into prompts
  },
})

await memoryAgent.run("example.com is owned by John Doe", bedrock({ model: "<your-bedrock-model-id>", maxOutputTokens: 4096 }))
// Later: agent remembers "example.com" entity and ownership fact

// With vector memory (semantic search)
import { OllamaEmbedding } from "@obsku/provider-ollama"

const semanticAgent = agent({
  name: "assistant",
  prompt: "Assistant with semantic memory",
  memory: {
    enabled: true,
    store,
    entityMemory: true,
    longTermMemory: true,
    contextInjection: true,
    embeddingProvider: new OllamaEmbedding({ model: "multilingual-e5-large", dimension: 1024 }), // auto-embed entities & facts
  },
})
// Entities/facts are embedded automatically; queries use semantic search
```

See [`packages/framework/README.md`](./packages/framework/README.md) for full documentation.

## Status

**Current**: Framework P12 complete. `bun test` 3417 pass 0 fail (203 files).  
**Graph**: Cyclic DAG executor with subgraphs + parallel waves + checkpoints  
**Checkpoint**: Integrated into framework with InMemory, SQLite, Redis, PostgreSQL backends (time-travel, fork/branch)  
**Multi-Agent**: Supervisor and Crew patterns with checkpoint integration  
**Memory**: Entity extraction, long-term facts, context injection with checkpoint backends  
**Vector Memory**: Semantic search with Bedrock/Ollama embeddings (InMemory + SQLite)  
**Telemetry**: OpenTelemetry auto-instrumentation  
**Tests**: Full test coverage with parallel execution verification

APIs are stabilizing but not yet 1.0.

## Safety
Authorized security testing only.
