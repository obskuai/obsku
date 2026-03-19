# @obsku/checkpoint-redis

Redis-based persistence for @obsku/checkpoint.

## Overview

This package provides a distributed, in-memory implementation of the `CheckpointStore` interface using Redis. It's suitable for production use where high-performance, distributed sessions are needed.

## Installation

```bash
npm install @obsku/checkpoint-redis
```

## Quick Start

```typescript
import { RedisCheckpointStore } from "@obsku/checkpoint-redis";

// Create store with Redis URL
const store = new RedisCheckpointStore({ url: "redis://localhost:6379" });

// Use like any CheckpointStore
const session = await store.createSession("./my-project", {
  title: "Security Scan",
});

// ... use store

// Close when done
await store.close();
```

## API Reference

### RedisCheckpointStore

```typescript
import { RedisCheckpointStore } from "@obsku/checkpoint-redis";

const store = new RedisCheckpointStore({
  url: "redis://localhost:6379",
  prefix: "obsku:", // optional, default: "obsku:"
});
```

**Constructor Options**:
- `url`: Redis connection URL (optional, defaults to localhost:6379)
- `prefix`: Key prefix for namespace isolation (default: "obsku:")

**Features**:
- Auto-connect on first operation
- Distributed storage for multi-instance deployments
- In-memory performance with persistence options
- JSON serialization with JsonPlusSerializer for complex types

## Redis Key Schema

### Sessions
- `{prefix}session:{id}` - Session JSON data

### Messages
- `{prefix}messages:{sessionId}` - Sorted Set (score = createdAt)
- `{prefix}message:counter:{sessionId}` - Auto-increment counter for message IDs

### Checkpoints
- `{prefix}checkpoint:{id}` - Checkpoint JSON data
- `{prefix}checkpoints:{sessionId}:{namespace}` - Sorted Set index (score = createdAt)
- `{prefix}versions:{sessionId}:{namespace}` - Hash mapping version -> checkpointId

## Usage with Framework

```typescript
import { RedisCheckpointStore } from "@obsku/checkpoint-redis";
import { graph, run } from "@obsku/framework";

const store = new RedisCheckpointStore({ url: process.env.REDIS_URL });

const myGraph = graph({
  // ... graph config
});

// Run with checkpointing
const result = await run(myGraph, {
  input: "Scan example.com",
  checkpointStore: store,
  onCheckpoint: (cp) => console.log("Saved:", cp.id),
});

// Resume later
const session = await store.getSession(sessionId);
const latest = await store.getLatestCheckpoint(session.id);

const resumed = await run(myGraph, {
  input: "Continue scanning",
  checkpointStore: store,
  sessionId: session.id,
  resumeFrom: latest,
});
```

## Forking Sessions

```typescript
// Create a checkpoint
const checkpoint = await store.saveCheckpoint({
  sessionId: session.id,
  namespace: "main",
  version: 1,
  step: 5,
  nodeResults: { /* ... */ },
  pendingNodes: [],
  source: "loop",
});

// Fork from checkpoint (creates new session)
const forkedSession = await store.fork(checkpoint.id, {
  title: "Experiment: Alternative approach",
});

// Forked session has all messages up to checkpoint
// Original session is unchanged
```

## Performance Notes

- Uses `redis` npm package (node-redis)
- Sorted Sets for efficient time-ordered queries
- SCAN for production-safe key iteration (no KEYS blocking)
- In-memory storage provides sub-millisecond latency
- Supports Redis Cluster for horizontal scaling
- Pub/Sub ready for real-time checkpoint notifications

## Environment Variables

- `REDIS_URL`: Redis connection URL (e.g., `redis://localhost:6379`)

## Cleanup

Always close the store when done:

```typescript
await store.close();
```

This closes the Redis connection gracefully.

## License

MIT
