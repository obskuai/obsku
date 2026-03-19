# @obsku/checkpoint-postgres

PostgreSQL-based persistence for @obsku/checkpoint.

## Overview

This package provides a durable, scalable implementation of the `CheckpointStore` interface using PostgreSQL. It supports connection pooling, transactional operations, and is suitable for production deployments requiring shared state across multiple processes.

## Installation

```bash
npm install @obsku/checkpoint-postgres
```

## Quick Start

```typescript
import { PostgresCheckpointStore } from "@obsku/checkpoint-postgres";

const store = new PostgresCheckpointStore(process.env.POSTGRES_URL!);

await store.setup();

const session = await store.createSession("./my-project", {
  title: "Security Scan",
});

await store.close();
```

## API Reference

### PostgresCheckpointStore

```typescript
import { PostgresCheckpointStore } from "@obsku/checkpoint-postgres";

const store = new PostgresCheckpointStore(connectionString, options?);
await store.setup();
```

**Constructor Parameters**:
- `connectionString`: PostgreSQL connection string (e.g., `postgresql://user:pass@host:5432/db`)
- `options`: Optional `PoolConfig` from `pg` library

**Important**: Call `setup()` before using the store to create database tables.

## Database Schema

### Tables

**sessions**
- `id` (TEXT PRIMARY KEY)
- `workspace_id` (TEXT, indexed)
- `title` (TEXT)
- `directory` (TEXT, NOT NULL)
- `created_at` (BIGINT)
- `updated_at` (BIGINT)
- `metadata` (TEXT, JSON serialized)

**messages**
- `id` (SERIAL PRIMARY KEY) - auto-incrementing
- `session_id` (TEXT, FOREIGN KEY with CASCADE)
- `role` (TEXT)
- `content` (TEXT)
- `tool_calls` (TEXT, JSON serialized)
- `tool_results` (TEXT, JSON serialized)
- `tokens_in` (INTEGER)
- `tokens_out` (INTEGER)
- `created_at` (BIGINT)

**checkpoints**
- `id` (TEXT PRIMARY KEY)
- `session_id` (TEXT, FOREIGN KEY with CASCADE)
- `namespace` (TEXT)
- `parent_id` (TEXT)
- `version` (INTEGER)
- `step` (INTEGER)
- `node_id` (TEXT)
- `node_results` (TEXT, JSON serialized)
- `pending_nodes` (TEXT, JSON serialized)
- `cycle_state` (TEXT, JSON serialized)
- `source` (TEXT)
- `created_at` (BIGINT)
- UNIQUE constraint on (session_id, namespace, version)

### Indexes

- `idx_sessions_workspace`: workspace_id + updated_at DESC
- `idx_messages_session`: session_id + created_at
- `idx_checkpoints_session`: session_id + namespace + step

## Migration

The `setup()` method must be called before using the store. It creates all required tables and indexes if they don't exist:

```typescript
const store = new PostgresCheckpointStore(connectionString);
await store.setup();
```

## Usage with Framework

```typescript
import { PostgresCheckpointStore } from "@obsku/checkpoint-postgres";
import { graph, run } from "@obsku/framework";

const store = new PostgresCheckpointStore(process.env.POSTGRES_URL!);
await store.setup();

const myGraph = graph({
  // ... graph config
});

const result = await run(myGraph, {
  input: "Scan example.com",
  checkpointStore: store,
  onCheckpoint: (cp) => console.log("Saved:", cp.id),
});

await store.close();
```

## Forking Sessions

Fork operations are transactional, ensuring atomicity:

```typescript
const checkpoint = await store.saveCheckpoint({
  sessionId: session.id,
  namespace: "main",
  version: 1,
  step: 5,
  nodeResults: { /* ... */ },
  pendingNodes: [],
  source: "loop",
});

const forkedSession = await store.fork(checkpoint.id, {
  title: "Experiment: Alternative approach",
});
```

## Performance Notes

- **Connection Pooling**: Uses `pg.Pool` for efficient connection management
- **SERIAL for IDs**: Message IDs auto-increment via PostgreSQL SERIAL
- **Indexed Queries**: All common queries use indexed columns
- **Transactional Fork**: Fork operation uses BEGIN/COMMIT for consistency
- **JSON Serialization**: Complex types (Date, Map, Set, Buffer) handled via `JsonPlusSerializer`

## Environment Variables

Set `POSTGRES_URL` for the connection string:

```bash
export POSTGRES_URL="postgresql://user:password@localhost:5432/obsku"
```

## Cleanup

Always close the store when done to release pool connections:

```typescript
await store.close();
```

## Testing

Tests are skipped if `POSTGRES_URL` is not set:

```bash
POSTGRES_URL="postgresql://..." bun test
```

## License

MIT
