/**
 * `createChangeManager` regression tests.
 *
 * Guards the dialect fix: `createChangeManager` used to build a
 * `ChangeContext` without `dialect`, so `ChangeManager` fell back to
 * `context.dialect ?? 'postgres'` (src/core/change/manager.ts:89) and every
 * sqlite/mysql TUI project queried the postgres schema-qualified
 * `noorm.change` instead of the prefixed `__noorm_change__`
 * (`getNoormTables` in src/core/shared/tables.ts). That query fails,
 * `ChangeHistory.getAllStatuses()` swallows the error into an empty Map,
 * and the caller sees success over zero changes -- a silent no-op.
 *
 * Uses a real in-memory sqlite Kysely connection with the noorm tracking
 * tables (mirrors tests/core/change/manager.test.ts's harness) so the
 * assertions exercise the actual dialect-to-table-name wiring rather than
 * a snapshot of the built context.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';
import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';

import { createChangeManager } from '../../../src/tui/utils/change-context.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { resetLockManager } from '../../../src/core/lock/index.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { Config } from '../../../src/core/config/types.js';
import type { ChangeContext } from '../../../src/core/change/types.js';

// `ChangeManager` stores its context in a true private (`#context`) field,
// so there is no way to read back what `createChangeManager` built for it
// once construction returns. Subclassing and swapping the export via
// `mock.module` is the only way to observe the constructor argument
// itself; every method still delegates to the real class, so this is
// functionally identical to `ChangeManager` everywhere else it's used.
const actualManagerModule = await import('../../../src/core/change/manager.js');
const capturedContexts: ChangeContext[] = [];

class SpyChangeManager extends actualManagerModule.ChangeManager {

    constructor(context: ChangeContext) {

        super(context);
        capturedContexts.push(context);

    }

}

mock.module('../../../src/core/change/manager.js', () => ({
    ChangeManager: SpyChangeManager,
}));

describe('tui: createChangeManager', () => {

    let db: Kysely<NoormDatabase>;
    let tempDir: string;
    let changesDir: string;
    let sqlDir: string;

    const testCryptoIdentity = {
        identityHash: 'test-hash',
        name: 'Test User',
        email: 'test@example.com',
        publicKey: 'test-public-key',
        machine: 'test-machine',
        os: 'test-os',
        createdAt: new Date().toISOString(),
    };

    /**
     * A sqlite `Config`, shaped like what `StateManager` hands to TUI
     * screens as `activeConfig`.
     */
    function buildActiveConfig(): Config {

        return {
            name: 'test',
            type: 'local',
            isTest: true,
            access: { user: 'admin', mcp: 'admin' },
            connection: {
                dialect: 'sqlite',
                database: ':memory:',
            },
        };

    }

    /**
     * Create a test change on disk so `manager.run()` can load it by name.
     */
    async function createTestChange(
        name: string,
        changeFiles: Array<{ name: string; content: string }>,
    ): Promise<void> {

        const changeFilesDir = join(changesDir, name, 'change');

        await mkdir(changeFilesDir, { recursive: true });

        for (const file of changeFiles) {

            await writeFile(join(changeFilesDir, file.name), file.content);

        }

    }

    beforeEach(async () => {

        resetLockManager();
        capturedContexts.length = 0;

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-change-context-test-'));
        changesDir = join(tempDir, 'changes');
        sqlDir = join(tempDir, 'sql');

        await mkdir(changesDir, { recursive: true });
        await mkdir(sqlDir, { recursive: true });

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

    });

    afterEach(async () => {

        resetLockManager();

        await db.destroy();

        await rm(tempDir, { recursive: true, force: true });

    });

    afterAll(() => {

        mock.module('../../../src/core/change/manager.js', () => actualManagerModule);

    });

    it('should read history seeded in the sqlite-prefixed tracking table, not the postgres schema-qualified one', async () => {

        // Seeds `__noorm_change__` directly -- the table `getNoormTables('sqlite')`
        // targets. If `dialect` is dropped from the context again, the manager
        // defaults to 'postgres', queries `noorm.change` (which doesn't exist in
        // this database), and `getAllStatuses()` swallows that failure into an
        // empty Map -- this row would silently vanish from `list()`.
        await db
            .insertInto('__noorm_change__')
            .values({
                name: 'seed-change',
                change_type: 'change',
                direction: 'change',
                status: 'success',
                config_name: 'test',
                executed_by: 'Test User',
                cli_version: '0.0.0',
                checksum: 'abc123',
            })
            .execute();

        const manager = createChangeManager({
            db,
            configName: 'test',
            projectRoot: tempDir,
            settings: null,
            cryptoIdentity: testCryptoIdentity,
            activeConfig: buildActiveConfig(),
        });

        const list = await manager.list();
        const seeded = list.find((item) => item.name === 'seed-change');

        expect(seeded).toBeDefined();
        expect(seeded?.status).toBe('success');

    });

    it('should run and record a change end-to-end against the sqlite dialect', async () => {

        await createTestChange('add-widgets-table', [
            { name: '001.sql', content: 'CREATE TABLE widgets (id INTEGER PRIMARY KEY)' },
        ]);

        const manager = createChangeManager({
            db,
            configName: 'test',
            projectRoot: tempDir,
            settings: null,
            cryptoIdentity: testCryptoIdentity,
            activeConfig: buildActiveConfig(),
        });

        const result = await manager.run('add-widgets-table');

        expect(result.status).toBe('success');

        const list = await manager.list();
        const applied = list.find((item) => item.name === 'add-widgets-table');

        expect(applied?.status).toBe('success');
        expect(applied?.orphaned).toBe(false);

    });

    it('should populate context.config and context.dialect on the built ChangeContext from activeConfig', () => {

        const activeConfig = buildActiveConfig();

        createChangeManager({
            db,
            configName: 'test',
            projectRoot: tempDir,
            settings: null,
            cryptoIdentity: testCryptoIdentity,
            activeConfig,
        });

        expect(capturedContexts).toHaveLength(1);
        expect(capturedContexts[0]?.config).toBe(activeConfig as unknown as Record<string, unknown>);
        expect(capturedContexts[0]?.dialect).toBe('sqlite');

    });

});
