FROM oven/bun:latest

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/framework/package.json packages/framework/package.json
COPY packages/blob-fs/package.json packages/blob-fs/package.json
COPY packages/checkpoint-redis/package.json packages/checkpoint-redis/package.json
COPY packages/checkpoint-postgres/package.json packages/checkpoint-postgres/package.json
COPY packages/checkpoint-sqlite/package.json packages/checkpoint-sqlite/package.json
COPY packages/adapters/agent-server/package.json packages/adapters/agent-server/package.json

RUN bun install

COPY packages/framework/src packages/framework/src
COPY packages/blob-fs/src packages/blob-fs/src
COPY packages/checkpoint-redis/src packages/checkpoint-redis/src
COPY packages/checkpoint-postgres/src packages/checkpoint-postgres/src
COPY packages/checkpoint-sqlite/src packages/checkpoint-sqlite/src
COPY packages/adapters/agent-server/src packages/adapters/agent-server/src
COPY packages/adapters/agent-server/test/test-server.ts packages/adapters/agent-server/test/test-server.ts

EXPOSE 9000

CMD ["bun", "run", "packages/adapters/agent-server/test/test-server.ts"]
