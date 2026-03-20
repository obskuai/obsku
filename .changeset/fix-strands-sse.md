---
"@obsku/adapter-agent-server": patch
---

fix(agent-server): restore Strands SSE wire format for agentcore protocol

The agentcore handler was emitting a custom SSE envelope (`event: stream.chunk` + `data: {type, sessionId, data}`). GenU expects the Strands format (`data: {"event":{"contentBlockDelta":{...}}}`). Restored the correct wire format by reconnecting `strands-sse.ts` formatters.
