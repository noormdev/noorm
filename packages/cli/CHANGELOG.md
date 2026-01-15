# @noormdev/cli

## 1.0.0-alpha.7

### Patch Changes

- cb9f9c2: Display template errors during dry-run in UI feedback

  Template rendering errors during dry-run were silently captured in results but never emitted via the observer event system, making them invisible in the UI. Now `file:dry-run` events include status and error fields, and the progress hook properly tracks failed dry-runs.

## 1.0.0-alpha.6

### Patch Changes

- Fix bundle: inject version at build time instead of requiring package.json

## 1.0.0-alpha.5

### Patch Changes

- Add state loading error output to version command for debugging

## 1.0.0-alpha.4

### Patch Changes

- Add `noorm version` command for diagnostic output showing CLI version, identity paths, and project status

## 1.0.0-alpha.3

### Patch Changes

- ac0b3c1: Rebuild with complete bundling fixes

## 1.0.0-alpha.2

### Patch Changes

- b22c1ec: ## CLI

  ### Fixed

  - `fix(build):` Add CJS compatibility shim for dynamic require in ESM bundle

## 1.0.0-alpha.1

### Patch Changes

- 9673054: ## CLI

  ### Fixed

  - `fix(build):` Bundle all pure JS dependencies (meow, ink, react, pg, mysql2, tedious) - only better-sqlite3 remains external due to native bindings

## 1.0.0-alpha.0

### Major Changes

- 6b3cce1: Initial release of noorm - Database Schema & Change Manager

  ## @noormdev/cli

  ### Features

  - **Terminal UI** - Full-featured TUI for managing database schemas
  - **Headless Mode** - CLI commands with JSON output for CI/CD pipelines
  - **Multi-Dialect Support** - PostgreSQL, MySQL, SQLite, MSSQL
  - **Change Detection** - Checksum-based tracking, only changed files re-execute
  - **SQL Templates** - Dynamic SQL with Eta templating engine
  - **Change Management** - Versioned migrations with forward/revert support
  - **Schema Explorer** - Browse tables, views, indexes, functions from terminal
  - **SQL Terminal** - Built-in REPL with query history
  - **Config Management** - Multiple database configs with encrypted storage
  - **Secrets** - Encrypted secret storage with template injection
  - **Stages** - Environment templates for teams
  - **Protected Configs** - Safety guards for production databases
  - **Locking** - Concurrent operation control
  - **Identity** - Audit trail with git-based identity

  ## @noormdev/sdk

  ### Features

  - **Programmatic API** - Full access to noorm functionality
  - **Context-based** - Single entry point via `createContext()`
  - **Type-safe** - Full TypeScript support
  - **Observable** - Event-based architecture with `@logosdx/observer`
  - **Test Integration** - `requireTest` guard for safe test database usage
