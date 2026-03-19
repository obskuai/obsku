# @obsku/checkpoint-sqlite

SQLite-based persistence for @obsku/checkpoint.

## Overview

This package provides a durable, file-based implementation of the `CheckpointStore` interface using SQLite. It's suitable for production use where sessions and checkpoints need to persist across process restarts.

## Installation

```bash
npm install @obsku/checkpoint-sqlite
```

## Quick Start

```typescript
import { SqliteCheckpointStore } from "@obsku/checkpoint-sqlite";

// Create store with database file
const store = new SqliteCheckpointStore("./checkpoints.db");

// Use like any CheckpointStore
const session = await store.createSession("./my-project", {
  title: "Security Scan",
});

// ... use store

// Close when done
await store.close();
```

## API Reference

### SqliteCheckpointStore

```typescript
import { SqliteCheckpointStore } from "@obsku/checkpoint-sqlite";

const store = new SqliteCheckpointStore("./checkpoints.db");
```

**Constructor Options**:
- `dbPath`: Path to SQLite database file (created if doesn't exist)

**Features**:
- Automatic schema creation on first use
- Foreign key constraints with CASCADE delete
- Indexed columns for efficient queries
- JSON serialization for complex types

## Database Schema

### Tables

**sessions**
- `id` (TEXT PRIMARY KEY)
- `workspace_id` (TEXT, indexed)
- `title` (TEXT)
- `directory` (TEXT, NOT NULL)
- `created_at` (INTEGER)
- `updated_at` (INTEGER)
- `metadata` (TEXT, JSON serialized)

**messages**
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `session_id` (TEXT, FOREIGN KEY)
- `role` (TEXT)
- `content` (TEXT)
- `tool_calls` (TEXT, JSON serialized)
- `tool_results` (TEXT, JSON serialized)
- `tokens_in` (INTEGER)
- `tokens_out` (INTEGER)
- `created_at` (INTEGER)

**checkpoints**
- `id` (TEXT PRIMARY KEY)
- `session_id` (TEXT, FOREIGN KEY)
- `namespace` (TEXT)
- `parent_id` (TEXT)
- `version` (INTEGER)
- `step` (INTEGER)
- `node_id` (TEXT)
- `node_results` (TEXT, JSON serialized)
- `pending_nodes` (TEXT, JSON serialized)
- `cycle_state` (TEXT, JSON serialized)
- `source` (TEXT)
- `created_at` (INTEGER)

### Indexes

- `idx_sessions_workspace`: workspace_id + updated_at DESC
- `idx_messages_session`: session_id + created_at
- `idx_checkpoints_session`: session_id + namespace + step
- `idx_checkpoints_version`: UNIQUE (session_id, namespace, version)

## Usage with Framework

```typescript
import { SqliteCheckpointStore } from "@obsku/checkpoint-sqlite";
import { graph, run } from "@obsku/framework";

const store = new SqliteCheckpointStore("./checkpoints.db");

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

- Uses `bun:sqlite` (Bun's native SQLite binding)
- Prepared statements for common queries
- Foreign keys ensure data integrity
- Indexes support efficient filtering
- JSON columns use `JsonPlusSerializer` for complex types

## Cleanup

Always close the store when done:

```typescript
await store.close();
```

This closes the database connection. The data remains in the file for future use.

## License

MIT
