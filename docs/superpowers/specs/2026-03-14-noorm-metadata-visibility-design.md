# noorm Metadata Visibility


## Problem

noorm tracks rich metadata internally (`__noorm_version__` table, state/settings versions, DB object counts) but none of it is surfaced to the user. There's no way to know what schema version you're running, when noorm was installed/upgraded, or get a quick snapshot of your database's composition — all useful for diagnostics, support (screenshot-based assessment), and general awareness.


## Solution

Two changes:

1. **Enrich the Home screen header** with version metadata and DB object stats — always visible, zero navigation required
2. **Add a headless `info` command** (`noorm -H info`) that outputs the same data plus identity and connection details as JSON


## TUI: Home Screen Header


### Layout

```
noorm v0.4.2 - Database Schema & Change Manager
schema: v1  |  state: v1  |  settings: v1  |  installed: 2026-01-15  |  upgraded: 2026-03-10
Active Config:  dev  |  Configs: 1

5 tbls  12 vws  8 fns  9 procs  13 types
```

- **Line 1**: Existing title line, now includes CLI version
- **Line 2**: New metadata line — schema/state/settings versions, install and upgrade dates. Dimmed styling.
- **Line 3**: Existing active config line (unchanged)
- **Line 4**: New DB object stats line. Compact format. Dimmed styling.


### Data Sources

| Data | Source | When Available |
|------|--------|----------------|
| CLI version | `getCurrentVersion()` from `src/core/update/checker.ts` | Always |
| Schema version | `getFullVersionRecord(db).noormVersion` | When connected + tables exist |
| State version | `CURRENT_VERSIONS.state` from `src/core/version/types.ts` | Always (compile-time constant) |
| Settings version | `CURRENT_VERSIONS.settings` from `src/core/version/types.ts` | Always (compile-time constant) |
| Install date | `getFullVersionRecord(db).installedAt` (from first `__noorm_version__` row) | When connected + tables exist |
| Upgrade date | `getFullVersionRecord(db).upgradedAt` (from latest `__noorm_version__` row) | When connected + tables exist |
| DB object stats | `fetchOverview(db, dialect)` from `src/core/explore/operations.ts` | When connected |


### Graceful Degradation

- **DB disconnected**: Version line still shows (CLI version is local, state/settings from local files). Stats line hidden. Dates show `--`.
- **No tracking tables**: Schema version shows `v0` or `not initialized`. Install/upgrade dates show `--`.
- **Dialect-specific stats**: Categories with 0 items are hidden from the stats line (e.g., SQLite won't show `0 procs`). If all categories are 0, line shows "empty database".


### Data Fetching

All new data fetches run in parallel alongside the existing Home screen status checks (connection, pending count, lock status) inside the existing `useAsyncEffect`. No additional render cycles.

- Version record query: single `SELECT` from `__noorm_version__` ordered by `id DESC LIMIT 1`
- Object counts: reuse `fetchOverview(db, dialect)` from `src/core/explore/operations.ts` (already excludes noorm internal tables by default)


### Version Record Query

The existing `getLatestVersionRecord()` returns only `stateVersion` and `settingsVersion`. We need a fuller version that also returns `cli_version`, `noorm_version`, `installed_at`, and `upgraded_at`. Rather than modifying the existing function (which is used by the migration system), add a new function:

```typescript
interface FullVersionRecord {
    cliVersion: string;
    noormVersion: number;
    stateVersion: number;
    settingsVersion: number;
    installedAt: Date;   // from FIRST row (ORDER BY id ASC LIMIT 1)
    upgradedAt: Date;    // from LATEST row (ORDER BY id DESC LIMIT 1)
}

export async function getFullVersionRecord(
    db: Kysely<NoormDatabase>,
): Promise<FullVersionRecord | null>
```

Located in `src/core/version/schema/index.ts` alongside the existing version functions.

**Query strategy**: Two simple queries — one for the latest row (all fields + `upgraded_at`) and one for the first row (`installed_at` only). Both use Kysely's `.limit(1)` which abstracts dialect differences (e.g., MSSQL `TOP 1` vs Postgres `LIMIT 1`). The queries run in parallel via `Promise.all`. If no rows exist, returns `null`.


### DB Object Stats Categories

The `fetchOverview()` function returns 10 categories, but the stats line displays only the 5 most relevant for schema awareness:

- **tables** (`tbls`)
- **views** (`vws`)
- **functions** (`fns`)
- **procedures** (`procs`)
- **types** (`types`)

Categories `indexes`, `foreignKeys`, `triggers`, `locks`, and `connections` are omitted from the stats line — they are operational/structural details better suited to `db explore`.

**Performance note**: `fetchOverview()` with `includeNoormTables: false` (default) runs 10 parallel list queries and counts in JS. This is acceptable for the Home screen since it runs once on mount alongside existing status checks. If profiling shows this is too heavy, a future optimization could add a count-only query path to the explore dialect operations.


## Headless: `info` Command


### Invocation

```bash
noorm -H info              # Human-readable output
noorm -H --json info       # JSON output for scripting
```


### JSON Output Shape

```json
{
    "cli_version": "0.4.2",
    "schema_version": 1,
    "state_version": 1,
    "settings_version": 1,
    "installed_at": "2026-01-15T08:30:00.000Z",
    "upgraded_at": "2026-03-10T14:22:00.000Z",
    "active_config": "dev",
    "config_count": 1,
    "connection": {
        "host": "localhost",
        "port": 5432,
        "database": "taxgentic_dev",
        "dialect": "postgresql"
    },
    "identity": {
        "name": "Alonso",
        "email": "alonso@example.com",
        "machine": "macbook-pro",
        "registered_at": "2026-01-15T08:30:00.000Z",
        "last_seen_at": "2026-03-13T22:00:00.000Z"
    },
    "objects": {
        "tables": 5,
        "views": 12,
        "functions": 8,
        "procedures": 9,
        "types": 13
    }
}
```

- `connection` is `null` if DB is disconnected (with `connection_error` string)
- `identity` is `null` if no identity configured. `name`, `email`, `machine` come from local `CryptoIdentity` (always available if identity exists). `registered_at` and `last_seen_at` come from the `__noorm_identities__` table — these are `null` when DB is disconnected.
- `objects` is `null` if DB is disconnected
- No credentials are ever included in connection details


### Human-Readable Output

```
noorm v0.4.2
schema: v1  |  state: v1  |  settings: v1
installed: 2026-01-15  |  upgraded: 2026-03-10

Config:     dev (2 configs)
Connection: localhost:5432/taxgentic_dev (postgresql)
Identity:   Alonso <alonso@example.com>

Objects:    5 tbls  12 vws  8 fns  9 procs  13 types
```


### Registration

- Add `'info'` to the `Route` type union in `src/cli/types.ts`. This is a **headless-only route** — no TUI screen component is needed. The TUI screen router already handles unknown routes gracefully (renders nothing / stays on current screen), and `info` is not navigable from within the TUI.
- Create `src/cli/headless/info.ts` following the existing handler pattern (`RouteHandler` with `run` and `help`)
- Register in `src/cli/headless/index.ts` HANDLERS map


### Relationship to `version` Command

The existing `noorm version` command is a low-level diagnostic tool: Node.js version, platform, architecture, identity key paths, project detection. It does not connect to the database.

`noorm info` is a project/database status command: schema versions, install/upgrade dates, connection details, DB object counts. It requires a database connection for most of its output.

Both commands remain — they serve different audiences (`version` for debugging installation issues, `info` for assessing runtime state).


## Files to Modify

| File | Change |
|------|--------|
| `src/core/version/schema/index.ts` | Add `getFullVersionRecord()` function |
| `src/core/explore/operations.ts` | No changes — `fetchOverview()` already provides what we need |
| `src/cli/screens/home.tsx` | Add version metadata line + DB stats line to header |
| `src/cli/types.ts` | Add `'info'` to Route union |
| `src/cli/headless/index.ts` | Register `info` handler |


## New Files

| File | Purpose |
|------|---------|
| `src/cli/headless/info.ts` | Headless `info` command handler |
| `help/info.txt` | Help file for the info command |


## Testing

| Test | File | What to test |
|------|------|--------------|
| `getFullVersionRecord()` | `tests/core/version/full-record.test.ts` | Returns all fields with correct types; returns `null` when no tables exist; `installedAt` comes from first row, `upgradedAt` from latest row |
| Home screen metadata | `tests/cli/screens/home.test.tsx` | Renders CLI version, version metadata line, and stats line when connected; hides stats and shows `--` for dates when disconnected; hides zero-count categories |
| Headless `info` command | `tests/cli/headless/info.test.ts` | Outputs correct JSON shape; `connection`/`objects` are `null` when disconnected; `identity` is `null` when unconfigured; identity `registered_at`/`last_seen_at` are `null` when connected but identity not in DB |

Home screen tests use `ink-testing-library` with `render()` / `lastFrame()` and mock the `useConnection` hook and `fetchOverview`/`getFullVersionRecord` calls. Headless tests mock `withContext` per existing headless test patterns.
