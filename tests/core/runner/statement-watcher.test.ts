/**
 * Statement watcher and run cancellation, on sqlite.
 *
 * sqlite has no server to ask, so these pin the dialect-independent contract:
 * a file that runs past the delay reports elapsed time on every interval, a
 * fast file reports nothing, reports stop the moment the file ends, and an
 * aborted run starts no further files. The server-side half (probes, blockers,
 * pg_cancel_backend) is covered in tests/integration/runner/statement-watcher.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';

import { observer } from '../../../src/core/observer.js';
import { OperationAbortedError } from '../../../src/core/shared/abort.js';
import { runFiles } from '../../../src/core/runner/runner.js';
import { StatementWatcher } from '../../../src/core/runner/statement-watcher.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { NoormEvents } from '../../../src/core/observer.js';
import type { RunContext } from '../../../src/core/runner/types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('runner: statement watcher', () => {

    let db: Kysely<NoormDatabase>;
    let reports: NoormEvents['file:progress'][];
    let stopListening: () => void;

    beforeEach(() => {

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({ database: new BunSqliteDatabase(':memory:') as never }),
        });

        reports = [];
        stopListening = observer.on('file:progress', (data) => {

            reports.push(data);

        });

    });

    afterEach(async () => {

        stopListening();
        await db.destroy();

    });

    it('should report a statement that outlives the delay, once per interval, with elapsed time', async () => {

        const watcher = new StatementWatcher(db, { dialect: 'sqlite', delayMs: 30, intervalMs: 40 });

        await watcher.run('slow.sql', db, async () => sleep(160));
        await watcher.close();

        expect(reports.length).toBeGreaterThanOrEqual(2);
        expect(reports.every((r) => r.filepath === 'slow.sql')).toBe(true);
        expect(reports[0]!.elapsedMs).toBeGreaterThanOrEqual(30);
        expect(reports[1]!.elapsedMs).toBeGreaterThan(reports[0]!.elapsedMs);

        expect(reports[0]!.sessionId).toBeNull();
        expect(reports[0]!.status).toBeNull();

    });

    it('should stay quiet for a statement that finishes before the delay', async () => {

        const watcher = new StatementWatcher(db, { dialect: 'sqlite', delayMs: 50, intervalMs: 50 });

        await watcher.run('fast.sql', db, async () => sleep(5));
        await sleep(120);
        await watcher.close();

        expect(reports).toHaveLength(0);

    });

    it('should stop reporting as soon as the statement ends', async () => {

        const watcher = new StatementWatcher(db, { dialect: 'sqlite', delayMs: 20, intervalMs: 20 });

        await watcher.run('slow.sql', db, async () => sleep(70));
        const countAtEnd = reports.length;

        await sleep(100);
        await watcher.close();

        expect(reports.length).toBe(countAtEnd);

    });

    it('should refuse to start a file once the signal has aborted', async () => {

        const controller = new AbortController();
        const watcher = new StatementWatcher(db, { dialect: 'sqlite', signal: controller.signal });
        let started = false;

        controller.abort();

        const outcome = await watcher.run('late.sql', db, async () => {

            started = true;

        }).then(() => null, (err: Error) => err);
        await watcher.close();

        // The abort listener has nothing to cancel before a file is active, so
        // without this check the file would run to completion after a cancel.
        expect(outcome).toBeInstanceOf(OperationAbortedError);
        expect(started).toBe(false);

    });

    it('should run the SQL on the connection it hands out and return its result', async () => {

        const watcher = new StatementWatcher(db, { dialect: 'sqlite' });

        const result = await watcher.run('one.sql', db, (conn) => sql<{ n: number }>`select 1 as n`.execute(conn));
        await watcher.close();

        expect(result.rows[0]?.n).toBe(1);

    });

});

describe('runner: run cancellation', () => {

    let db: Kysely<NoormDatabase>;
    let tempDir: string;
    let files: string[];

    function buildContext(signal: AbortSignal): RunContext {

        return {
            db,
            configName: 'test',
            identity: { name: 'Test User', email: 'test@example.com', source: 'config' },
            projectRoot: tempDir,
            access: { user: 'admin', agent: 'admin' },
            channel: 'user',
            dialect: 'sqlite',
            signal,
        };

    }

    async function tableExists(name: string): Promise<boolean> {

        const rows = await sql<{ name: string }>`
            SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}
        `.execute(db);

        return rows.rows.length > 0;

    }

    beforeEach(async () => {

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-runner-cancel-test-'));
        await mkdir(join(tempDir, 'sql'), { recursive: true });

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({ database: new BunSqliteDatabase(':memory:') as never }),
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

        files = [join(tempDir, 'sql', '001_a.sql'), join(tempDir, 'sql', '002_b.sql')];
        await writeFile(files[0]!, 'CREATE TABLE cancel_a (id INTEGER PRIMARY KEY);\n', 'utf-8');
        await writeFile(files[1]!, 'CREATE TABLE cancel_b (id INTEGER PRIMARY KEY);\n', 'utf-8');

    });

    afterEach(async () => {

        await db.destroy();
        await rm(tempDir, { recursive: true, force: true });

    });

    it('should start no file when the run is cancelled before it begins', async () => {

        const controller = new AbortController();
        controller.abort();

        const result = await runFiles(buildContext(controller.signal), files);

        expect(result.status).toBe('failed');
        expect(result.error).toBe('Run cancelled');
        expect(result.filesRun).toBe(0);
        expect(await tableExists('cancel_a')).toBe(false);

    });

    it('should not start the next file once cancelled between files', async () => {

        const controller = new AbortController();
        const stop = observer.on('file:after', ({ filepath }) => {

            if (filepath === files[0]) controller.abort();

        });

        const result = await runFiles(buildContext(controller.signal), files);
        stop();

        expect(await tableExists('cancel_a')).toBe(true);
        expect(await tableExists('cancel_b')).toBe(false);
        expect(result.error).toBe('Run cancelled');
        expect(result.status).toBe('partial');

    });

    it('should not run a file whose cancel landed after it was picked up but before it started', async () => {

        const controller = new AbortController();
        const stop = observer.on('file:before', ({ filepath }) => {

            if (filepath === files[1]) controller.abort();

        });

        const result = await runFiles(buildContext(controller.signal), files);
        stop();

        // file:before fires before the SQL is sent, when no statement is active
        // for the abort listener to cancel.
        expect(await tableExists('cancel_b')).toBe(false);
        expect(result.error).toBe('Run cancelled');
        expect(result.files).toHaveLength(1);
        expect(result.filesFailed).toBe(0);

    });

});
