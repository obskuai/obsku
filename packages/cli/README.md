# @obsku/cli

CLI for @obsku/framework — scaffold new agent projects.

## Installation

```bash
npm install -g @obsku/cli
```

## Commands

### `obsku init <project-name>`

Creates a new obsku project with a ready-to-run agent scaffold:

```bash
obsku init my-agent
cd my-agent
bun install
bun start
```

Generated project includes:
- `package.json` with `@obsku/framework` dependency
- `tsconfig.json` configured for ESM + TypeScript
- `src/index.ts` with a starter agent template

### `obsku --version`

Show the installed CLI version.

### `obsku --help`

Show available commands and usage.

## License

MIT
