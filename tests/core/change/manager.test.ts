/**
 * Change manager tests.
 *
 * Integration tests for ChangeManager against a real in-memory SQLite
 * database, mirroring tests/core/change/executor.test.ts's harness.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';
import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';

import { ChangeManager } from '../../../src/core/change/manager.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { resetLockManager } from '../../../src/core/lock/index.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { ChangeContext } from '../../../src/core/change/types.js';

describe('change: manager', () => {

    let db: Kysely<NoormDatabase>;
    let tempDir: string;
    let changesDir: string;
    let sqlDir: string;

    const testIdentity = { name: 'Test User', email: 'test@example.com', source: 'config' as const };

    /**
     * Create a test change on disk, with both change and revert SQL.
     */
    async function createTestChange(name: string): Promise<void> {

        const changeDir = join(changesDir, name, 'change');
        const revertDir = join(changesDir, name, 'revert');

        await mkdir(changeDir, { recursive: true });
        await mkdir(revertDir, { recursive: true });

        // Table name must not start with a digit (SQLite unquoted identifier rule).
        const tableName = `tbl_${name.replace(/-/g, '_')}`;

        await writeFile(join(changeDir, '001.sql'), `CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY)`);
        await writeFile(join(revertDir, '001.sql'), `DROP TABLE ${tableName}`);

    }

    function buildContext(): ChangeContext {

        return {
            db,
            configName: 'test',
            identity: testIdentity,
            projectRoot: tempDir,
            changesDir,
            sqlDir,
            access: { user: 'admin', mcp: 'admin' },
            channel: 'user',
            dialect: 'sqlite',
        };

    }

    beforeEach(async () => {

        resetLockManager();

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-manager-test-'));
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

    describe('rewind', () => {

        it('should compute a result instead of throwing when 2 SQLite changes are applied', async () => {

            // The ticket's literal repro: pre-fix, ChangeManager.rewind()'s sort
            // comparator calls `a.appliedAt?.getTime()` on `appliedAt` values
            // that SQLite's driver hands back as raw strings, not Dates —
            // throwing `TypeError: a.appliedAt?.getTime is not a function`
            // before rewind() ever computes a status.
            await createTestChange('2025-01-01-first');
            await createTestChange('2025-01-02-second');

            const manager = new ChangeManager(buildContext());

            const first = await manager.run('2025-01-01-first');
            const second = await manager.run('2025-01-02-second');

            expect(first.status).toBe('success');
            expect(second.status).toBe('success');

            const result = await manager.rewind(2);

            expect(result).toBeDefined();
            expect(['success', 'partial', 'failed']).toContain(result.status);

        });

    });

});
