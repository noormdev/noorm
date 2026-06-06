# cli

## What it does

Citty-based CLI with 17 top-level command groups. Each command group maps to a subdirectory under `src/cli/`. Commands emit events via the observer and delegate to core modules. Headless mode (`--yes`, `--json`) suppresses interactive prompts and formats output as JSON.

Published as `@noormdev/cli` from `packages/cli/`.

## Artifacts

- `packages/cli/package.json` — published package `@noormdev/cli`, version `1.0.0-alpha.35`; entry `noorm.js`
- `packages/cli/noorm.js` — thin wrapper that runs the compiled binary
- `packages/cli/scripts/postinstall.js` — postinstall script for binary extraction
- `packages/cli/CHANGELOG.md` — CLI release history
- `skills/noorm/SKILL.md` — Claude Code skill for noorm CLI usage
- `skills/noorm/references/cli.md` — comprehensive CLI command reference (1011L)
- `skills/noorm/references/config.md` — config management reference
- `skills/noorm/references/sdk.md` — SDK reference for skill use
- `skills/noorm/references/templates.md` — template reference for skill use

## CLI code

- `src/cli/index.ts` — citty entry point; registers all subcommands, help interceptor, `--cwd` global flag
- `src/cli/_utils.ts` — shared CLI utilities: headless detection, output formatting, flag parsing
- `src/cli/change/` — `change add|edit|ff|history|list|next|revert|rewind|rm|run` (13 files)
- `src/cli/ci/` — `ci init|secrets|identity/*` — CI automation commands
- `src/cli/config/` — `config add|cp|edit|export|import|list|rm|use|validate` (10 files)
- `src/cli/db/` — `db create|drop|explore*|reset|teardown|transfer|truncate` (16 files)
- `src/cli/dev/` — `dev test-helpers|test-workers` — internal diagnostics
- `src/cli/identity/` — `identity edit|export|init|list`
- `src/cli/lock/` — `lock acquire|force|release|status`
- `src/cli/mcp/` — `mcp init|serve`
- `src/cli/run/` — `run build|dir|exec|file|files|inspect|preview` (8 files)
- `src/cli/secret/` — `secret list|rm|set`
- `src/cli/settings/` — `settings build|edit|init|secret` (5 files)
- `src/cli/sql/` — `sql clear|history|query|repl`
- `src/cli/vault/` — `vault cp|init|list|propagate|rm|set`
- `src/cli/init.ts` — `noorm init` — project initialization wizard
- `src/cli/info.ts` — `noorm info` — display project + env info
- `src/cli/ui.ts` — `noorm ui` — launch TUI
- `src/cli/update.ts` — `noorm update` — self-update
- `src/cli/version.ts` — `noorm version` — print version info

## Docs

- `docs/cli/` — 9 user-facing CLI reference pages
- `docs/dev/headless.md` — headless mode internals
- `docs/guide/automation/non-interactive.md` — non-interactive usage
- `docs/guide/automation/ci.md` — CI usage
- `docs/guide/automation/mcp.md` — MCP usage
- `docs/headless.md` — public headless reference (1592L)

## Coupling

- Every CLI command imports from `src/core/` — any core API change may require CLI command updates.
- `src/cli/ui.ts` launches the TUI (`src/tui/app.tsx`) — TUI startup is a CLI concern.
- `src/cli/mcp/serve.ts` starts the MCP server from `src/mcp/server.ts` — MCP domain depends on CLI entry.
- Headless mode output shape is consumed by CI pipelines and SDK integration tests.
- `settings.paths.sql` and `settings.paths.changes` from `settings.yml` are the correct path sources (not per-config `paths` fields) — several run-related screens use `settings?.paths?.changes ?? 'changes'` pattern.

## Conventions worth knowing

- Commands attach `examples: string[]` to their `defineCommand` result; the help interceptor in `src/cli/index.ts` appends them after citty's auto-generated usage.
- `--cwd <path>` global flag (like `git -C`) must precede the subcommand.
- `--yes` / `-y` flag suppresses all confirmation prompts (headless mode).
- `--json` flag formats output as machine-readable JSON.
- Build produces a standalone binary via `bun build --compile` — worker paths must use `resolveWorker()`.
- Workspace package `@noormdev/cli` publishes the pre-built binary; `postinstall.js` extracts it.
