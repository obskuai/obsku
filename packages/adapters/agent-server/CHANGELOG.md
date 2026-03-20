# @obsku/adapter-agent-server

## 0.2.3

### Patch Changes

- 28ea09c: fix(agent-server): restore Strands SSE wire format for agentcore protocol

  The agentcore handler was emitting a custom SSE envelope (`event: stream.chunk` + `data: {type, sessionId, data}`). GenU expects the Strands format (`data: {"event":{"contentBlockDelta":{...}}}`). Restored the correct wire format by reconnecting `strands-sse.ts` formatters.

## 0.2.2

### Patch Changes

- Updated dependencies [ed41827]
  - @obsku/framework@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [0e5980a]
  - @obsku/framework@0.2.1

## 0.2.0

### Minor Changes

- d3ed382: Initial public release (0.2.0)

### Patch Changes

- Updated dependencies [d3ed382]
  - @obsku/framework@0.2.0
