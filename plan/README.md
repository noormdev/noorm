# noorm - Detailed Planning


## Domain Files

### Utilities (Cross-Cutting)

| File | Description |
|------|-------------|
| [utils.md](./utils.md) | Observer events, error tuples, retry, batch patterns |
| [logger.md](./logger.md) | File logging, write queue, verbosity levels |
| [lifecycle.md](./lifecycle.md) | Startup/shutdown, graceful exit, cleanup |

### Core

| File | Description |
|------|-------------|
| [state.md](./state.md) | StateManager, encryption, machine ID, persistence |
| [connection.md](./connection.md) | Kysely setup, connection factory |
| [config.md](./config.md) | Config structure, validation, environment variables |
| [identity.md](./identity.md) | User identity resolution |
| [lock.md](./lock.md) | Concurrent operation locking |
| [template.md](./template.md) | Eta integration, data loading, context |
| [runner.md](./runner.md) | Build, file, dir execution, tracking, preview mode |
| [changeset.md](./changeset.md) | Changeset structure, parsing, execution, history |
| [settings.md](./settings.md) | Project settings, build rules, stages |
| [version.md](./version.md) | CLI version tracking, schema migrations |

### CLI (by feature)

| File | Description |
|------|-------------|
| [cli/core.md](./cli/core.md) | Router, app shell, global keyboard, headless mode |
| [cli/app-context.md](./cli/app-context.md) | Centralized state, connection lifecycle, status bar |
| [cli/home.md](./cli/home.md) | Home screen, tab navigation |
| [cli/init.md](./cli/init.md) | Project initialization command |
| [cli/config.md](./cli/config.md) | Config screens (add, edit, rm, list, cp, use, validate) |
| [cli/secret.md](./cli/secret.md) | Secret screens (list, set, rm) |
| [cli/settings.md](./cli/settings.md) | Settings screens (view, edit, init) |
| [cli/change.md](./cli/change.md) | Changeset screens (add, edit, rm, list, run, revert, rewind, next, ff) |
| [cli/run.md](./cli/run.md) | Run screens (list, build, exec, file, dir) |
| [cli/db.md](./cli/db.md) | DB screens (create, destroy) |
| [cli/lock.md](./cli/lock.md) | Lock screens (status, acquire, release, force-release) |
| [cli/components.md](./cli/components.md) | Shared UI components (includes FilePicker) |


## Implementation Order

### Phase 0: Utilities (Read First)

0. **utils.md** - Observer, attempt(), retry(), batch() patterns used everywhere
1. **logger.md** - Logging infrastructure extends observer
2. **lifecycle.md** - Startup/shutdown coordination

### Phase 1: Foundation

3. **state.md** - Everything depends on this
4. **connection.md** - Database connectivity
5. **config.md** - Depends on state + connection
6. **settings.md** - Project-level configuration
7. **version.md** - CLI version tracking

### Phase 2: Core Features

8. **identity.md** - Small, standalone
9. **lock.md** - Depends on connection
10. **template.md** - Standalone

### Phase 3: Execution

11. **runner.md** - Depends on connection, template, lock
12. **changeset.md** - Depends on runner

### Phase 4: CLI

13. **cli/core.md** - Router, shell
14. **cli/app-context.md** - Centralized state provider
15. **cli/components.md** - Shared components (FilePicker, etc.)
16. **cli/init.md** - Project initialization
17. **cli/home.md** - Home screen
18. **cli/config.md** - Config feature
19. **cli/secret.md** - Secret management
20. **cli/settings.md** - Settings management
21. **cli/change.md** - Changeset feature
22. **cli/run.md** - Run feature
23. **cli/db.md** - DB feature
24. **cli/lock.md** - Lock feature


## Main Plan

See [../plan.md](../plan.md) for the high-level overview.
