# noorm - Detailed Planning


## Domain Files

### Utilities (Cross-Cutting)

| File | Description |
|------|-------------|
| [utils.md](./utils.md) | Observer events, error tuples, retry, batch patterns |

### Core

| File | Description |
|------|-------------|
| [state.md](./state.md) | StateManager, encryption, machine ID, persistence |
| [connection.md](./connection.md) | Kysely setup, connection factory |
| [config.md](./config.md) | Config structure, validation, environment variables |
| [identity.md](./identity.md) | User identity resolution |
| [lock.md](./lock.md) | Concurrent operation locking |
| [template.md](./template.md) | Eta integration, data loading, context |
| [runner.md](./runner.md) | Build, file, dir execution, tracking |
| [changeset.md](./changeset.md) | Changeset structure, parsing, execution, history |

### CLI (by feature)

| File | Description |
|------|-------------|
| [cli/core.md](./cli/core.md) | Router, app shell, global keyboard, headless mode |
| [cli/home.md](./cli/home.md) | Home screen, tab navigation |
| [cli/config.md](./cli/config.md) | Config screens (add, edit, rm, list, cp, use) |
| [cli/change.md](./cli/change.md) | Changeset screens (add, edit, rm, list, run, revert, next, ff) |
| [cli/run.md](./cli/run.md) | Run screens (build, file, dir) |
| [cli/db.md](./cli/db.md) | DB screens (create, destroy) |
| [cli/lock.md](./cli/lock.md) | Lock screens (status, release) |
| [cli/components.md](./cli/components.md) | Shared UI components |


## Implementation Order

### Phase 0: Utilities (Read First)

0. **utils.md** - Observer, attempt(), retry(), batch() patterns used everywhere

### Phase 1: Foundation

1. **state.md** - Everything depends on this
2. **connection.md** - Database connectivity
3. **config.md** - Depends on state + connection

### Phase 2: Core Features

4. **identity.md** - Small, standalone
5. **lock.md** - Depends on connection
6. **template.md** - Standalone

### Phase 3: Execution

7. **runner.md** - Depends on connection, template, lock
   8. **changeset.md** - Depends on runner

### Phase 4: CLI

9. **cli/core.md** - Router, shell
10. **cli/components.md** - Shared components
11. **cli/home.md** - Home screen
12. **cli/config.md** - Config feature
13. **cli/change.md** - Changeset feature
14. **cli/run.md** - Run feature
15. **cli/db.md** - DB feature
16. **cli/lock.md** - Lock feature


## Main Plan

See [../plan.md](../plan.md) for the high-level overview.
