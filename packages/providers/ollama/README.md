# @obsku/provider-ollama

Ollama embedding provider for @obsku/framework.

## Installation

```bash
npm install @obsku/provider-ollama
```

## Quick Start

```typescript
import { OllamaEmbedding } from "@obsku/provider-ollama";

const embeddings = new OllamaEmbedding({
  model: "multilingual-e5-large",
  dimension: 1024,
  host: "http://localhost:11434",
});

const vector = await embeddings.embed("example.com is reachable over HTTPS");
```

## API Reference

### `OllamaEmbedding`

Creates embeddings with a local or remote Ollama instance.

## License

MIT
