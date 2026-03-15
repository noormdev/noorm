# Metadata Visibility Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface noorm metadata (versions, install/upgrade dates, DB object stats) on the Home screen and via a new headless `info` command.

**Architecture:** Add `getFullVersionRecord()` to the version module for querying full version metadata. Enrich the Home screen header with version info and DB stats using existing `fetchOverview()`. Add a new headless `info` command that combines version metadata, connection details, identity info, and object counts into JSON output.

**Tech Stack:** Kysely (queries), Ink/React (TUI), bun:test (testing)

**Spec:** `docs/superpowers/specs/2026-03-14-noorm-metadata-visibility-design.md`

---

## Chunk 1: Core + Headless

### Task 1: Add `getFullVersionRecord()` to version module

**Files:**
- Modify: `src/core/version/schema/index.ts` (add function + type after line 258)
- Test: `tests/core/version/schema.test.ts` (add describe block at end)

- [ ] **Step 1: Write the failing tests**

Add to `tests/core/version/schema.test.ts` at the end, inside the outer `describe`:

```typescript
describe('getFullVersionRecord', () => {

    it('should return null when tables do not exist', async () => {

        const record = await getFullVersionRecord(db);

        expect(record).toBeNull();

    });

    it('should return all fields after bootstrap', async () => {

        await bootstrapSchema(db, 'sqlite');

        const record = await getFullVersionRecord(db);

        expect(record).not.toBeNull();
        expect(record!.cliVersion).toBe(getCurrentVersion());
        expect(record!.noormVersion).toBe(CURRENT_VERSIONS.schema);
        expect(record!.stateVersion).toBe(CURRENT_VERSIONS.state);
        expect(record!.settingsVersion).toBe(CURRENT_VERSIONS.settings);
        expect(record!.installedAt).toBeDefined();
        expect(record!.upgradedAt).toBeDefined();

    });

    it('should return installedAt from first row and upgradedAt from latest row', async () => {

        await bootstrapSchema(db, 'sqlite');

        // Insert a second version record (simulates upgrade)
        const laterDate = new Date(Date.now() + 86400000).toISOString();
        await db
            .insertInto('__noorm_version__')
            .values({
                cli_version: '99.0.0',
                noorm_version: CURRENT_VERSIONS.schema,
                state_version: 2,
                settings_version: 2,
                upgraded_at: laterDate as unknown as Date,
            })
            .execute();

        const record = await getFullVersionRecord(db);

        expect(record).not.toBeNull();
        // Latest row's data
        expect(record!.cliVersion).toBe('99.0.0');
        expect(record!.stateVersion).toBe(2);
        expect(record!.settingsVersion).toBe(2);
        // installedAt should be from the FIRST row (earlier)
        // upgradedAt should be from the LATEST row (later)
        const installedTime = new Date(record!.installedAt).getTime();
        const upgradedTime = new Date(record!.upgradedAt).getTime();
        expect(upgradedTime).toBeGreaterThan(installedTime);

    });

});
```

- [ ] **Step 2: Add import for `getFullVersionRecord` to the test file**

Add `getFullVersionRecord` to the import from `'../../../src/core/version/schema/index.js'` in `tests/core/version/schema.test.ts`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/core/version/schema.test.ts`
Expected: FAIL — `getFullVersionRecord` is not exported

- [ ] **Step 4: Add `FullVersionRecord` type and `getFullVersionRecord()` function**

Add to `src/core/version/schema/index.ts` after the `getLatestVersionRecord` function (after line 258):

```typescript
/**
 * Full version record for metadata display.
 *
 * Combines data from the first and latest version rows:
 * - installedAt from the first row (initial bootstrap)
 * - All other fields from the latest row (most recent state)
 */
export interface FullVersionRecord {
    /** CLI semver from latest row */
    cliVersion: string;

    /** Database tracking tables version */
    noormVersion: number;

    /** State file schema version */
    stateVersion: number;

    /** Settings file schema version */
    settingsVersion: number;

    /** When noorm was first installed (from first row) */
    installedAt: Date;

    /** When noorm was last upgraded (from latest row) */
    upgradedAt: Date;
}

/**
 * Get full version record for metadata display.
 *
 * Combines the first row's installed_at with the latest row's
 * remaining fields. Returns null if no tracking tables exist.
 *
 * @example
 * ```typescript
 * const record = await getFullVersionRecord(db);
 * if (record) {
 *     console.log(`noorm v${record.cliVersion}, schema v${record.noormVersion}`);
 *     console.log(`installed: ${record.installedAt}`);
 * }
 * ```
 */
export async function getFullVersionRecord(
    db: Kysely<NoormDatabase>,
): Promise<FullVersionRecord | null> {

    const exists = await tablesExist(db);
    if (!exists) return null;

    const [results, err] = await attempt(() =>
        Promise.all([
            // Latest row: all fields + upgraded_at
            db
                .selectFrom('__noorm_version__')
                .select([
                    'cli_version',
                    'noorm_version',
                    'state_version',
                    'settings_version',
                    'upgraded_at',
                ])
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
            // First row: installed_at only
            db
                .selectFrom('__noorm_version__')
                .select('installed_at')
                .orderBy('id', 'asc')
                .limit(1)
                .executeTakeFirst(),
        ]),
    );

    if (err) return null;

    const [latest, first] = results;
    if (!latest || !first) return null;

    return {
        cliVersion: latest.cli_version,
        noormVersion: latest.noorm_version,
        stateVersion: latest.state_version,
        settingsVersion: latest.settings_version,
        installedAt: first.installed_at,
        upgradedAt: latest.upgraded_at,
    };

}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/core/version/schema.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/version/schema/index.ts tests/core/version/schema.test.ts
git commit -m "feat(version): add getFullVersionRecord for metadata display"
```

---

### Task 2: Add `'info'` route to CLI types

**Files:**
- Modify: `src/cli/types.ts` (add route to union)

- [ ] **Step 1: Add `'info'` to the Route type union**

In `src/cli/types.ts`, add `| 'info'` after the `| 'home'` line (around line 79), in the "Home & Help" section:

```typescript
    // Home & Help
    | 'help'
    | 'home'
    | 'info'
    | 'more'
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors — `info` is a valid route but unused handlers are fine due to `Partial<Record<Route, ...>>`)

- [ ] **Step 3: Commit**

```bash
git add src/cli/types.ts
git commit -m "feat(cli): add info route to Route type union"
```

---

### Task 3: Force `info` route to headless mode

**Files:**
- Modify: `src/cli/index.tsx` (add headless override for `info`, near line 177)

- [ ] **Step 1: Add headless override for `info`**

In `src/cli/index.tsx`, find the block that forces `version` to headless (around line 176-181):

```typescript
    // Version command always runs headless (no TUI screen for it)
    if (route === 'version') {

        return { mode: 'headless', route, params, flags };

    }
```

Add the `info` route to this check:

```typescript
    // Version and info commands always run headless (no TUI screen for them)
    if (route === 'version' || route === 'info') {

        return { mode: 'headless', route, params, flags };

    }
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/index.tsx
git commit -m "feat(cli): force info route to headless mode"
```

---

### Task 4: Create headless `info` command handler

**Files:**
- Create: `src/cli/headless/info.ts`
- Modify: `src/cli/headless/index.ts` (register handler)

- [ ] **Step 1: Create `src/cli/headless/info.ts`**

```typescript
/**
 * Info command for project/database status.
 *
 * Surfaces noorm metadata: schema versions, install/upgrade dates,
 * connection details, identity info, and DB object counts.
 * Complements the `version` command which focuses on low-level
 * diagnostics (Node, platform, key paths).
 *
 * @example
 * ```bash
 * noorm -H info
 * noorm -H --json info
 * ```
 */
import { attempt } from '@logosdx/utils';
import type { Kysely } from 'kysely';

import type { HeadlessCommand } from './_helpers.js';
import { outputResult, outputError } from './_helpers.js';
import { getCurrentVersion } from '../../core/update/checker.js';
import { CURRENT_VERSIONS } from '../../core/version/types.js';
import { getFullVersionRecord } from '../../core/version/schema/index.js';
import { fetchOverview } from '../../core/explore/index.js';
import { loadIdentityMetadata } from '../../core/identity/storage.js';
import { getStateManager } from '../../core/state/index.js';
import { findProjectRoot } from '../../core/project.js';
import { createConnection } from '../../core/connection/index.js';
import type { NoormDatabase } from '../../core/shared/tables.js';
import type { ExploreOverview } from '../../core/explore/index.js';
import type { FullVersionRecord } from '../../core/version/schema/index.js';

// =============================================================================
// Types
// =============================================================================

interface InfoResult {
    cli_version: string;
    schema_version: number;
    state_version: number;
    settings_version: number;
    installed_at: string | null;
    upgraded_at: string | null;
    active_config: string | null;
    config_count: number;
    connection: {
        host: string | undefined;
        port: number | undefined;
        database: string;
        dialect: string;
    } | null;
    connection_error?: string;
    identity: {
        name: string;
        email: string;
        machine: string;
        registered_at: string | null;
        last_seen_at: string | null;
    } | null;
    objects: {
        tables: number;
        views: number;
        functions: number;
        procedures: number;
        types: number;
    } | null;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format a date for human-readable output.
 */
function formatDate(date: Date | string | null | undefined): string {

    if (!date) return '--';

    const d = date instanceof Date ? date : new Date(date);

    return d.toISOString().split('T')[0]!;

}

/**
 * Format object stats for human-readable output.
 */
function formatObjectStats(objects: InfoResult['objects']): string {

    if (!objects) return '--';

    const parts: string[] = [];

    if (objects.tables > 0) parts.push(`${objects.tables} tbls`);
    if (objects.views > 0) parts.push(`${objects.views} vws`);
    if (objects.functions > 0) parts.push(`${objects.functions} fns`);
    if (objects.procedures > 0) parts.push(`${objects.procedures} procs`);
    if (objects.types > 0) parts.push(`${objects.types} types`);

    return parts.length > 0 ? parts.join('  ') : 'empty database';

}

/**
 * Gather all info data.
 */
async function gatherInfo(): Promise<InfoResult> {

    // === Declaration block ===
    const cliVersion = getCurrentVersion();
    let activeConfigName: string | null = null;
    let configCount = 0;
    let connectionInfo: InfoResult['connection'] = null;
    let connectionError: string | undefined;
    let versionRecord: FullVersionRecord | null = null;
    let overview: ExploreOverview | null = null;
    let identityDbInfo: { registeredAt: string | null; lastSeenAt: string | null } | null = null;

    // === Validation block ===
    // Load identity metadata (local — no DB needed)
    const [identityMeta] = await attempt(() => loadIdentityMetadata());

    // Find project and load state
    const projectResult = findProjectRoot();

    if (projectResult.hasProject && projectResult.projectRoot) {

        const [manager] = await attempt(async () => {

            const mgr = getStateManager(projectResult.projectRoot!);
            await mgr.load();

            return mgr;

        });

        if (manager) {

            const configs = manager.listConfigs();
            configCount = configs.length;
            const active = manager.getActiveConfig();
            activeConfigName = active?.name ?? null;

            // === Business logic block ===
            // Try connecting to the active config's database
            if (active) {

                connectionInfo = {
                    host: active.connection.host,
                    port: active.connection.port,
                    database: active.connection.database,
                    dialect: active.connection.dialect,
                };

                const [conn, connErr] = await attempt(() =>
                    createConnection(active.connection, active.name),
                );

                if (connErr) {

                    connectionError = connErr.message;

                }
                else if (conn) {

                    const db = conn.db as Kysely<NoormDatabase>;

                    // Fetch version record and overview in parallel
                    const [results] = await attempt(() =>
                        Promise.all([
                            getFullVersionRecord(db),
                            fetchOverview(db as Kysely<unknown>, active.connection.dialect),
                        ]),
                    );

                    if (results) {

                        versionRecord = results[0];
                        overview = results[1];

                    }

                    // Fetch identity DB info if we have a local identity
                    if (identityMeta?.identityHash) {

                        const [row] = await attempt(async () =>
                            (db as Kysely<NoormDatabase>)
                                .selectFrom('__noorm_identities__')
                                .select(['registered_at', 'last_seen_at'])
                                .where('identity_hash', '=', identityMeta.identityHash)
                                .executeTakeFirst(),
                        );

                        if (row) {

                            identityDbInfo = {
                                registeredAt: row.registered_at ? new Date(row.registered_at as unknown as string).toISOString() : null,
                                lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at as unknown as string).toISOString() : null,
                            };

                        }

                    }

                    await attempt(() => conn.destroy());

                }

            }

        }

    }

    // === Commit block ===
    return {
        cli_version: cliVersion,
        schema_version: versionRecord?.noormVersion ?? CURRENT_VERSIONS.schema,
        state_version: CURRENT_VERSIONS.state,
        settings_version: CURRENT_VERSIONS.settings,
        installed_at: versionRecord?.installedAt ? new Date(versionRecord.installedAt as unknown as string).toISOString() : null,
        upgraded_at: versionRecord?.upgradedAt ? new Date(versionRecord.upgradedAt as unknown as string).toISOString() : null,
        active_config: activeConfigName,
        config_count: configCount,
        connection: connectionError ? null : connectionInfo,
        connection_error: connectionError,
        identity: identityMeta ? {
            name: identityMeta.name,
            email: identityMeta.email,
            machine: identityMeta.machine,
            registered_at: identityDbInfo?.registeredAt ?? null,
            last_seen_at: identityDbInfo?.lastSeenAt ?? null,
        } : null,
        objects: overview ? {
            tables: overview.tables,
            views: overview.views,
            functions: overview.functions,
            procedures: overview.procedures,
            types: overview.types,
        } : null,
    };

}

/**
 * Format info for human-readable output.
 */
function formatInfoOutput(info: InfoResult): string {

    const lines: string[] = [];

    // Version header
    lines.push(`noorm v${info.cli_version}`);
    lines.push(`schema: v${info.schema_version}  |  state: v${info.state_version}  |  settings: v${info.settings_version}`);
    lines.push(`installed: ${formatDate(info.installed_at)}  |  upgraded: ${formatDate(info.upgraded_at)}`);
    lines.push('');

    // Config
    if (info.active_config) {

        lines.push(`Config:     ${info.active_config} (${info.config_count} configs)`);

    }
    else {

        lines.push(`Config:     none (${info.config_count} configs)`);

    }

    // Connection
    if (info.connection) {

        const { host, port, database, dialect } = info.connection;
        const hostPort = port ? `${host}:${port}` : host;
        lines.push(`Connection: ${hostPort}/${database} (${dialect})`);

    }
    else if (info.connection_error) {

        lines.push(`Connection: Error - ${info.connection_error}`);

    }
    else {

        lines.push('Connection: --');

    }

    // Identity
    if (info.identity) {

        lines.push(`Identity:   ${info.identity.name} <${info.identity.email}>`);

    }
    else {

        lines.push('Identity:   Not configured');

    }

    lines.push('');

    // Objects
    lines.push(`Objects:    ${formatObjectStats(info.objects)}`);

    return lines.join('\n');

}

// =============================================================================
// Command
// =============================================================================

export const help = `
# INFO

Show noorm project and database status.

## Usage

    noorm info
    noorm -H --json info

## Description

Displays project metadata including:
- CLI version and internal schema versions
- Installation and upgrade timestamps
- Active configuration and connection details
- Identity information
- Database object counts (tables, views, functions, procedures, types)

For low-level diagnostics (Node.js, platform, key paths), use \`noorm version\`.

## Examples

    noorm -H info
    noorm -H --json info | jq '.objects'

## JSON Output

{
    "cli_version": "0.4.2",
    "schema_version": 1,
    "state_version": 1,
    "settings_version": 1,
    "installed_at": "2026-01-15T08:30:00.000Z",
    "upgraded_at": "2026-03-10T14:22:00.000Z",
    "active_config": "dev",
    "config_count": 2,
    "connection": {
        "host": "localhost",
        "port": 5432,
        "database": "mydb",
        "dialect": "postgresql"
    },
    "identity": {
        "name": "Your Name",
        "email": "you@example.com",
        "machine": "hostname",
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
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [info, err] = await attempt(() => gatherInfo());

    if (err) {

        return outputError(flags, logger, err.message);

    }

    if (flags.json) {

        logger.result(info);

    }
    else {

        process.stdout.write(formatInfoOutput(info) + '\n');

    }

    return 0;

};
```

- [ ] **Step 2: Register `info` handler in `src/cli/headless/index.ts`**

Add import at the top with the other imports:

```typescript
import * as CmdInfo from './info.js';
```

Add to the HANDLERS map, in the "Home & Help" section (after `'home'` around line 137):

```typescript
    'info': CmdInfo,
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/headless/info.ts src/cli/headless/index.ts
git commit -m "feat(cli): add headless info command for project/database status"
```

---

### Task 5: Create help file for `info` command

**Files:**
- Create: `help/info.txt`

Note: The headless help system uses the `help` string exported from each handler module (already done in Task 4). The `help/info.txt` file serves the TUI help viewer separately.

- [ ] **Step 1: Create `help/info.txt`**

```text
INFO - Show noorm project and database status

USAGE

    noorm info
    noorm -H --json info

DESCRIPTION

    Displays project metadata including CLI version, internal schema
    versions, installation and upgrade timestamps, active configuration
    and connection details, identity information, and database object
    counts (tables, views, functions, procedures, types).

    For low-level diagnostics (Node.js, platform, key paths), use
    noorm version instead.

EXAMPLES

    noorm -H info                          Human-readable output
    noorm -H --json info                   JSON output for scripting
    noorm -H --json info | jq '.objects'   Extract object counts

JSON OUTPUT (--json)

    {
        "cli_version": "0.4.2",
        "schema_version": 1,
        "state_version": 1,
        "settings_version": 1,
        "installed_at": "2026-01-15T08:30:00.000Z",
        "upgraded_at": "2026-03-10T14:22:00.000Z",
        "active_config": "dev",
        "config_count": 2,
        "connection": { "host": "localhost", "port": 5432, "database": "mydb", "dialect": "postgresql" },
        "identity": { "name": "Name", "email": "you@example.com", "machine": "host" },
        "objects": { "tables": 5, "views": 12, "functions": 8, "procedures": 9, "types": 13 }
    }

SEE ALSO

    noorm help version
```

- [ ] **Step 2: Commit**

```bash
git add help/info.txt
git commit -m "docs: add help file for info command"
```

---

## Chunk 2: Home Screen TUI

### Task 6: Enrich the Home screen header with metadata

**Files:**
- Modify: `src/cli/screens/home.tsx`

This task modifies the existing Home screen to add:
1. CLI version in the title line
2. Version metadata line (schema, state, settings, install date, upgrade date)
3. DB object stats line (tables, views, functions, procedures, types)

- [ ] **Step 1: Add new imports to `src/cli/screens/home.tsx`**

Add these imports at the top:

```typescript
import { getCurrentVersion } from '../../core/update/checker.js';
import { CURRENT_VERSIONS } from '../../core/version/types.js';
import { getFullVersionRecord, type FullVersionRecord } from '../../core/version/schema/index.js';
import { fetchOverview, type ExploreOverview } from '../../core/explore/index.js';
```

- [ ] **Step 2: Add metadata state variables**

After the existing state declarations (around line 94, after `const [isLoading, setIsLoading] = useState(true);`), add:

```typescript
    const [versionRecord, setVersionRecord] = useState<FullVersionRecord | null>(null);
    const [objectStats, setObjectStats] = useState<ExploreOverview | null>(null);
```

- [ ] **Step 3: Add metadata fetching to the existing `useAsyncEffect`**

Inside the `useAsyncEffect` callback (starting at line 121), the `attempt` block (line 164) fetches lock status, change info, and recent history. Add metadata fetches **in parallel** alongside the existing work.

**Before** (lines 164-198, inside the `attempt` callback):

```typescript
        const [result, err] = await attempt(async () => {

            // Get lock status
            const lockManager = getLockManager();
            const lockStatus = await lockManager.status(db, activeConfigName ?? '');

            // ... change history logic ...

            return { lockStatus, pendingCount, history };

        });
```

**After** — add the metadata fetches right before the `return`, using `attempt` so they degrade gracefully:

```typescript
        const [result, err] = await attempt(async () => {

            // Get lock status
            const lockManager = getLockManager();
            const lockStatus = await lockManager.status(db, activeConfigName ?? '');

            // ... change history logic (unchanged) ...

            // Get metadata (version record + object counts) in parallel
            const [[versionRec], [overview]] = await Promise.all([
                attempt(() => getFullVersionRecord(db)),
                attempt(() => fetchOverview(db as Kysely<unknown>, activeConfig!.connection.dialect)),
            ]);

            return { lockStatus, pendingCount, history, versionRec, overview };

        });
```

Then update the success handler (around line 216). **Before**:

```typescript
        else if (result && !isCancelled()) {

            setStatus({
                connection: 'connected',
                pendingCount: result.pendingCount,
                lockStatus: result.lockStatus,
            });
            setRecentActivity(result.history);

        }
```

**After**:

```typescript
        else if (result && !isCancelled()) {

            setStatus({
                connection: 'connected',
                pendingCount: result.pendingCount,
                lockStatus: result.lockStatus,
            });
            setRecentActivity(result.history);
            setVersionRecord(result.versionRec ?? null);
            setObjectStats(result.overview ?? null);

        }
```

- [ ] **Step 4: Add a date formatting helper and the version metadata rendering**

First, add a helper function inside the `HomeScreen` component (before the JSX return, around line 360):

```typescript
    /**
     * Format a date value for display. Handles the Date-typed-but-actually-string SQLite quirk.
     */
    function formatMetaDate(date: Date | null | undefined): string {

        if (!date) return '--';

        const d = date instanceof Date ? date : new Date(date as unknown as string);

        return d.toISOString().split('T')[0]!;

    }
```

Then modify the header JSX. Find the existing header block (around line 429-433):

```tsx
            {/* Header */}
            <Box marginBottom={1}>
                <Text bold>noorm</Text>
                <Text dimColor> - Database Schema & Change Manager</Text>
            </Box>
```

Replace it with:

```tsx
            {/* Header */}
            <Box flexDirection="column" marginBottom={1}>
                <Box>
                    <Text bold>noorm</Text>
                    <Text dimColor> v{getCurrentVersion()} - Database Schema & Change Manager</Text>
                </Box>
                <Box>
                    <Text dimColor>
                        schema: v{versionRecord?.noormVersion ?? CURRENT_VERSIONS.schema}
                        {'  |  '}state: v{CURRENT_VERSIONS.state}
                        {'  |  '}settings: v{CURRENT_VERSIONS.settings}
                        {'  |  '}installed: {formatMetaDate(versionRecord?.installedAt)}
                        {'  |  '}upgraded: {formatMetaDate(versionRecord?.upgradedAt)}
                    </Text>
                </Box>
            </Box>
```

- [ ] **Step 5: Add the DB object stats line**

After the Active Config line (around line 449, after the closing `</Box>` of the config summary), add the stats line:

```tsx
            {/* DB Object Stats */}
            {status.connection === 'connected' && objectStats && (
                <Box marginBottom={1}>
                    <Text dimColor>
                        {[
                            objectStats.tables > 0 ? `${objectStats.tables} tbls` : '',
                            objectStats.views > 0 ? `${objectStats.views} vws` : '',
                            objectStats.functions > 0 ? `${objectStats.functions} fns` : '',
                            objectStats.procedures > 0 ? `${objectStats.procedures} procs` : '',
                            objectStats.types > 0 ? `${objectStats.types} types` : '',
                        ].filter(Boolean).join('  ') || 'empty database'}
                    </Text>
                </Box>
            )}
```

- [ ] **Step 6: Also update the "no configs" and "no active config" headers**

Find the two early-return blocks for "no configs" (around line 367) and "no active config" (around line 399). Update their header `<Box>` to also include the version:

```tsx
                <Box marginBottom={1}>
                    <Text bold>noorm</Text>
                    <Text dimColor> v{getCurrentVersion()} - Database Schema & Change Manager</Text>
                </Box>
```

- [ ] **Step 7: Add `Kysely` type import**

Add `type { Kysely }` from `'kysely'` to imports if not already present:

```typescript
import type { Kysely } from 'kysely';
```

- [ ] **Step 8: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 9: Run existing tests**

Run: `bun test tests/cli/`
Expected: Existing tests still pass (the Home screen tests, if any, should not break)

- [ ] **Step 10: Commit**

```bash
git add src/cli/screens/home.tsx
git commit -m "feat(cli): show version metadata and DB stats on Home screen"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS — no type errors

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass (except pre-existing `better-sqlite3` failures in lock/version manager tests)

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: PASS — no lint errors

- [ ] **Step 4: Final commit if any fixes were needed**

Only if previous steps required fixes.
