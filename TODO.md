# noorm TODO


## Priority 1: Missing UI Features


### Runner Screens

The runner core module is complete (`src/core/runner/`) but has no TUI screens.

**Routes to implement:**
- `run` - Runner home/menu
- `run/build` - Execute build (all SQL files)
- `run/file` - Execute single file
- `run/dir` - Execute directory

**Core functions available:**
- `runBuild()` - Run all SQL files per settings
- `runFile()` - Run single SQL file with change detection
- `runDir()` - Run directory of SQL files

**Reference:** `docs/runner.md`


### Headless/CI Mode

Stub exists at `src/cli/headless.ts` with TODO at line 37.

**What exists:**
- `HeadlessLogger` class with JSON/human-readable output
- `shouldRunHeadless()` detection (CI env vars, TTY check)
- Event logging infrastructure

**What's missing:**
- Command handlers in `HANDLERS` registry
- No commands work in headless mode yet

**Commands to implement:**
- `change ff` - Fast-forward changesets
- `change next` - Apply next changeset
- `run build` - Execute build
- `config validate` - Validate config
- `lock status` - Check lock status


## Priority 2: Template Management UI

Core template engine is complete. No dedicated TUI screens exist.

Templates are accessed indirectly through the runner. Consider whether dedicated screens add value or if current approach is sufficient.


## Priority 3: Testing Library

Build a testing library that provides mechanisms for:
- Using stages
- Loading and running SQL files
- Using templates and seeding

This library would be used in tests when either building the entire DB or building an SDK for the DB.


## Completed Features

| Feature | Core | UI | Docs |
|---------|------|----|------|
| Config management | ✓ | ✓ 9 screens | ✓ |
| Changeset management | ✓ | ✓ 9 screens | ✓ |
| Secret management | ✓ | ✓ 3 screens | ✓ |
| Settings/stages/rules | ✓ | ✓ 13 screens | ✓ |
| Lock management | ✓ | ✓ 5 screens | ✓ |
| Identity management | ✓ | ✓ 6 screens | ✓ |
| Database management | ✓ | ✓ 3 screens | ✓ |
| State encryption | ✓ | N/A | ✓ |
| Template engine | ✓ | N/A | ✓ |
| Logger | ✓ | Minimal | ✓ |


## Implementation History

Core modules were implemented in phases:

1. **Utilities** - Observer, logger, lifecycle
2. **Foundation** - State, connection, config, settings, version
3. **Core Features** - Identity, lock, template
4. **Execution** - Runner, changeset
5. **CLI** - All screens implemented except runner

See `plan/` directory for detailed implementation plans used during development.
