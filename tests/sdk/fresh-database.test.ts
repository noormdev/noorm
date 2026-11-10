/** A build creates a current-state database from nothing, so the SDK must not need a prior CLI run. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';

import { ChangeNotAppliedError, createContext, ProtectedConfigError, ResetBuildError, VersionMismatchError } from '../../src/sdk/index.js';
import type { BatchResult, Context, CreateContextOptions } from '../../src/sdk/index.js';
import { attempt } from '@logosdx/utils';
import { resetStateManager } from '../../src/core/state/index.js';
import { CURRENT_VERSIONS } from '../../src/core/version/types.js';

describe('sdk: fresh database', () => {

    let root: string;
    let ctx: Context | undefined;

    beforeEach(async () => {

        root = await mkdtemp(join(tmpdir(), 'noorm-fresh-db-'));
        await mkdir(join(root, 'db', 'sql'), { recursive: true });
        await writeFile(join(root, 'db', 'sql', 'widget.sql'), 'CREATE TABLE widget (id INTEGER PRIMARY KEY);');

    });

    afterEach(async () => {

        await ctx?.disconnect();
        ctx = undefined;
        resetStateManager();
        await rm(root, { recursive: true, force: true });

    });

    async function open(options: CreateContextOptions = {}): Promise<Context> {

        ctx = await createContext({
            projectRoot: root,
            freshState: true,
            connection: { dialect: 'sqlite', database: join(root, 'fresh.db') },
            ...options,
        });
        await ctx.connect();

        return ctx;

    }

    async function tables(context: Context): Promise<string[]> {

        const found = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table'`.execute(context.kysely);

        return found.rows.map((row) => row.name);

    }

    async function addChange(): Promise<string> {

        const change = join(root, 'db', 'changes', '2026-01-01-add-gadget');
        await mkdir(join(change, 'change'), { recursive: true });
        await mkdir(join(change, 'revert'), { recursive: true });
        await writeFile(join(change, 'change', '001_gadget.sql'), 'CREATE TABLE gadget (id INTEGER PRIMARY KEY);');
        await writeFile(join(change, 'revert', '001_gadget.sql'), 'DROP TABLE gadget;');

        return '2026-01-01-add-gadget';

    }

    async function builtWithNewerTracking(): Promise<Context> {

        const context = await open();
        await context.noorm.run.build();
        await sql`UPDATE __noorm_version__ SET noorm_version = 999`.execute(context.kysely);

        return context;

    }

    it('should build a database that has no tracking tables yet', async () => {

        const context = await open();

        const result: BatchResult = await context.noorm.run.build();

        expect(result.status).toBe('success');
        expect(await tables(context)).toContain('widget');

    });

    it('should leave a fresh database untouched on a dry-run build', async () => {

        const context = await open();

        await context.noorm.run.build({ dryRun: true });

        expect(await tables(context)).toEqual([]);

    });

    it('should run a single file against a database that has no tracking tables yet', async () => {

        const context = await open();

        const result = await context.noorm.run.file('db/sql/widget.sql');

        expect(result.status).toBe('success');
        expect(await tables(context)).toContain('widget');

    });

    it('should reset a fresh database and report the rebuild', async () => {

        const context = await open();

        const result: BatchResult = await context.noorm.db.reset();

        expect(result.status).toBe('success');
        expect(result.filesRun).toBe(1);
        expect(await tables(context)).toContain('widget');

    });

    // A reset that tore down and did not rebuild must stop a test run instead of reporting success.
    it('should throw with the build result when the rebuild fails', async () => {

        await writeFile(join(root, 'db', 'sql', 'broken.sql'), 'CREATE TABLE (;');
        const context = await open();

        const [, err] = await attempt(() => context.noorm.db.reset());

        expect(err).toBeInstanceOf(ResetBuildError);
        expect((err as ResetBuildError).result.status).not.toBe('success');

    });

    it('should apply a change to a database that has no tracking tables yet', async () => {

        const change = await addChange();
        const context = await open();

        const result = await context.noorm.changes.apply(change);

        expect(result.status).toBe('success');
        expect(await tables(context)).toContain('gadget');

    });

    it.each([
        ['run.files', (context: Context) => context.noorm.run.files(['db/sql/widget.sql'])],
        ['run.dir', (context: Context) => context.noorm.run.dir('db/sql')],
    ])('should run %s against a database that has no tracking tables yet', async (_method, run) => {

        const context = await open();

        const result = await run(context);

        expect(result.status).toBe('success');
        expect(await tables(context)).toContain('widget');

    });

    it.each([
        ['ff', (context: Context) => context.noorm.changes.ff()],
        ['next', (context: Context) => context.noorm.changes.next()],
    ])('should apply pending changes with changes.%s on a database that has no tracking tables yet', async (_method, run) => {

        await addChange();
        const context = await open();

        const result = await run(context);

        expect(result.status).toBe('success');
        expect(await tables(context)).toContain('gadget');

    });

    it('should find nothing to rewind on a database that has no tracking tables yet', async () => {

        await addChange();
        const context = await open();

        const result = await context.noorm.changes.rewind(1);

        expect(result.executed).toBe(0);
        expect(result.failed).toBe(0);

    });

    it('should refuse to revert an unapplied change on a database that has no tracking tables yet', async () => {

        const change = await addChange();
        const context = await open();

        const [, err] = await attempt(() => context.noorm.changes.revert(change));

        expect(err).toBeInstanceOf(ChangeNotAppliedError);

    });

    it.each([['dryRun'], ['preview']] as const)('should refuse a %s revert of an unapplied change and create no tables', async (mode) => {

        const change = await addChange();
        const context = await open();

        const [, err] = await attempt(() => context.noorm.changes.revert(change, { [mode]: true }));

        expect(err).toBeInstanceOf(ChangeNotAppliedError);
        expect(await tables(context)).toEqual([]);

    });

    it.each([['dryRun'], ['preview']] as const)('should leave a fresh database untouched on a %s of changes', async (mode) => {

        await addChange();
        const context = await open();

        await context.noorm.changes.ff({ [mode]: true });

        expect(await tables(context)).toEqual([]);

    });

    async function addPipeline(): Promise<string> {

        const pipeline = join(root, 'db', 'pipelines', 'refresh');
        await mkdir(pipeline, { recursive: true });
        await writeFile(join(pipeline, 'pipeline.yml'), JSON.stringify({ steps: [{ id: 'piped', sql: 'piped.sql' }] }));
        await writeFile(join(pipeline, 'piped.sql'), 'CREATE TABLE piped (id INTEGER PRIMARY KEY);');

        return 'refresh';

    }

    it('should run a pipeline on a database that has no tracking tables yet', async () => {

        const slug = await addPipeline();
        const context = await open();

        const result = await context.noorm.pipelines.run(slug);

        expect(result.status).toBe('success');
        expect(await tables(context)).toContain('piped');
        expect((await context.noorm.pipelines.history(slug)).map((run) => run.status)).toEqual(['success']);

    });

    it('should leave a fresh database untouched on a dry-run pipeline', async () => {

        const slug = await addPipeline();
        const context = await open();

        const result = await context.noorm.pipelines.run(slug, { dryRun: true });

        expect(result.dryRun).toBe(true);
        expect(await tables(context)).toEqual([]);

    });

    it('should read an empty pipeline history without creating tracking tables', async () => {

        const context = await open();

        expect(await context.noorm.pipelines.history('refresh')).toEqual([]);
        expect(await context.noorm.pipelines.getRun(1)).toBeNull();
        expect(await tables(context)).toEqual([]);

    });

    it('should report no lock on a database that has no tracking tables yet', async () => {

        const context = await open();

        expect(await context.noorm.lock.status()).toEqual({ isLocked: false, lock: null });
        expect(await tables(context)).toEqual([]);

    });

    it('should read an empty change history without creating tracking tables', async () => {

        const context = await open();

        expect(await context.noorm.changes.history()).toEqual([]);
        expect(await tables(context)).toEqual([]);

    });

    it.each([
        ['changes.history', (context: Context) => context.noorm.changes.history()],
        ['changes.historyForChange', (context: Context) => context.noorm.changes.historyForChange('2026-01-01-add-gadget')],
        ['lock.status', (context: Context) => context.noorm.lock.status()],
        ['pipelines.history', (context: Context) => context.noorm.pipelines.history('refresh')],
        ['run.build dry run', (context: Context) => context.noorm.run.build({ dryRun: true })],
    ])('should refuse %s on older tracking tables and leave them unmigrated', async (_method, read) => {

        const context = await open();
        await context.noorm.run.build();
        const stored = CURRENT_VERSIONS.schema - 1;
        await sql`UPDATE __noorm_version__ SET noorm_version = ${stored}`.execute(context.kysely);

        const [, err] = await attempt(() => read(context));
        const versions = await sql<{ noorm_version: number }>`SELECT noorm_version FROM __noorm_version__`.execute(context.kysely);

        expect(err?.message).toContain(`tracking tables are at schema version ${stored} and this version needs ${CURRENT_VERSIONS.schema}`);
        expect(versions.rows).toEqual([{ noorm_version: stored }]);

    });

    // Tracking tables are a write, so a caller the policy refuses must not cause one.
    it.each([
        ['run.build', (context: Context) => context.noorm.run.build()],
        ['changes.ff', (context: Context) => context.noorm.changes.ff()],
        ['db.reset', (context: Context) => context.noorm.db.reset()],
        ['lock.acquire', (context: Context) => context.noorm.lock.acquire()],
        ['lock.withLock', (context: Context) => context.noorm.lock.withLock(async () => {})],
    ])('should create no tracking tables when policy denies %s', async (_method, run) => {

        const context = await open({ channel: 'agent' });

        const [, err] = await attempt(() => run(context));

        expect(err).toBeInstanceOf(ProtectedConfigError);
        expect(await tables(context)).toEqual([]);

    });

    it.each([
        ['run.build', (context: Context) => context.noorm.run.build()],
        ['changes.ff', (context: Context) => context.noorm.changes.ff()],
    ])('should refuse %s on a tracking schema newer than this version', async (_method, run) => {

        const context = await builtWithNewerTracking();

        const [, err] = await attempt(() => run(context));

        expect(err).toBeInstanceOf(VersionMismatchError);

    });

    // reset() drops first and rebuilds second, so anything that can refuse must refuse before the drop.
    it('should keep the schema when reset meets a tracking schema newer than this version', async () => {

        const context = await builtWithNewerTracking();

        const [, err] = await attempt(() => context.noorm.db.reset());

        expect(err).toBeInstanceOf(VersionMismatchError);
        expect(await tables(context)).toContain('widget');

    });

    it('should keep the schema when reset cannot read the schema directory', async () => {

        const context = await open();
        await context.noorm.run.build();
        await rm(join(root, 'db', 'sql'), { recursive: true });

        const [, err] = await attempt(() => context.noorm.db.reset());

        expect(err?.message).toContain(`cannot read the schema directory ${join(root, 'db', 'sql')}`);
        expect(err).not.toBeInstanceOf(ResetBuildError);
        expect(await tables(context)).toContain('widget');

    });

    it('should name the failing file when the rebuild fails', async () => {

        await writeFile(join(root, 'db', 'sql', 'broken.sql'), 'CREATE TABLE (;');
        const context = await open();

        const [, err] = await attempt(() => context.noorm.db.reset());

        expect(err?.message).toContain(join(root, 'db', 'sql', 'broken.sql'));

    });

    it('should take a lock around a build on a database that has no tracking tables yet', async () => {

        const context = await open();

        const result = await context.noorm.lock.withLock(() => context.noorm.run.build());

        expect(result.status).toBe('success');

    });

    it('should acquire a lock on a database that has no tracking tables yet', async () => {

        const context = await open();

        const lock = await context.noorm.lock.acquire();

        expect(lock.lockedBy).toBeTruthy();

    });

});
