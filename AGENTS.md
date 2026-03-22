# obsku

## Status
- Branch: `main`
- Repo state: stable release shipped (`@obsku/framework@0.2.3`, `@obsku/adapter-agent-server@0.2.5`); prerelease workflow fixed to publish real snapshot versions with npm auth
- Blocker: none
- Next steps: optional downstream validation against the new stable packages

## Dev Commands
- Build: `bun run build`
- Test: `bun run test` (NOT bare `bun test`; direct run double-counts via symlinks)
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Lint fix: `bun run lint:fix`
- Format: `bun run format`
- Format check: `bun run check`
- Publish matrix: `bun run verify:publish`
- Repo hygiene: `bun run verify:hygiene`

## Benchmark
- Run: `bun packages/benchmark/src/cli.ts --model amazon.nova-lite-v1:0`
- Rule: if user asks whether benchmark works, run it; do not answer with setup prerequisites
- Latest verified result: full suite passed `13/13`

## Release
- Stable: `.github/workflows/release.yml` (Changesets PR model)
- Prerelease: `.github/workflows/prerelease.yml` (manual snapshot publish)
- Stable release flow needs a real `.changeset/*.md`, then merge the generated `chore: version packages` PR

## Critical Files
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.github/workflows/prerelease.yml`
- `scripts/create-prerelease-changeset.ts`
- `scripts/verify-publish.ts`
- `packages/framework/src/output-policy/`
- `packages/adapters/agent-server/src/`
- `packages/benchmark/src/runner/context.ts`
- `packages/framework/test/background/task-manager-events.test.ts`
