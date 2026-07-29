/**
 * Checksum dedup for `.sql.tmpl` files through `run build`.
 *
 * The runner's headline promise is "run build as often as you like, only
 * changed files execute". For templates it was false on every build: the
 * checksum persisted upfront was the *raw file* hash while `needsRun`
 * compared the *rendered* hash, so the two could never match and every
 * template re-executed forever — failing on any non-idempotent DDL.
 *
 * `tests/core/runner/tracker.test.ts` cannot see this: it hands `needsRun`
 * checksums directly, so the raw-vs-rendered mismatch is invisible by
 * construction. These tests drive `runBuild` end to end instead, and pin
 * the *decision* the fix encodes — the rendered SQL is the dedup key, so a
 * template whose inputs changed re-runs even though its bytes did not.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect, sql } from 'kysely';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { runBuild } from '../../../src/core/runner/runner.js';
import { computeChecksumFromContent } from '../../../src/core/runner/checksum.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { RunContext } from '../../../src/core/runner/types.js';

describe('runner: template checksum dedup', () => {

    let db: Kysely<NoormDatabase>;
    let tempDir: string;
    let sqlDir: string;

    function context(): RunContext {

        return {
            db,
            configName: 'test',
            identity: { name: 'Test User', email: 'test@example.com', source: 'config' },
            projectRoot: tempDir,
            access: { user: 'admin', mcp: 'admin' },
            channel: 'user',
            dialect: 'sqlite',
        };

    }

    async function storedChecksums(): Promise<string[]> {

        const { rows } = await sql<{ checksum: string }>`
            SELECT checksum FROM __noorm_executions__ ORDER BY id DESC LIMIT 1
        `.execute(db);

        return rows.map((r) => r.checksum);

    }

    beforeEach(async () => {

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-tmpl-dedup-'));
        sqlDir = join(tempDir, 'sql');
        await mkdir(sqlDir, { recursive: true });

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

    });

    afterEach(async () => {

        await db.destroy();
        await rm(tempDir, { recursive: true, force: true });

    });

    it('should skip an unchanged .sql.tmpl on every subsequent build', async () => {

        // No template syntax at all: the renderer still strips boundary
        // newlines, so raw bytes and rendered output differ. That mismatch
        // alone was enough to re-execute the file forever.
        await writeFile(
            join(sqlDir, '001_t.sql.tmpl'),
            'CREATE TABLE tmpl_dedup (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const first = await runBuild(context(), sqlDir);

        expect(first.status).toBe('success');
        expect(first.filesRun).toBe(1);

        // Non-idempotent DDL: a second execution fails outright, which is
        // what made this a data-integrity bug rather than a slow build.
        const second = await runBuild(context(), sqlDir);

        expect(second.status).toBe('success');
        expect(second.filesSkipped).toBe(1);
        expect(second.files[0]?.skipReason).toBe('unchanged');

        // The third build is the one the previous skip-reason fix (dd7e387)
        // was about — a recorded `unchanged` skip must not read as "never ran".
        const third = await runBuild(context(), sqlDir);

        expect(third.status).toBe('success');
        expect(third.filesSkipped).toBe(1);

    });

    it('should persist the rendered checksum, not the raw file hash', async () => {

        const raw = 'CREATE TABLE tmpl_checksum (id INTEGER PRIMARY KEY);\n';
        await writeFile(join(sqlDir, '001_t.sql.tmpl'), raw, 'utf-8');

        const result = await runBuild(context(), sqlDir);

        expect(result.filesRun).toBe(1);

        // Which hash is canonical is the decision this fix records: the
        // rendered SQL is what actually reaches the database, so it is what
        // "has this changed?" must be asked about.
        const [stored] = await storedChecksums();

        expect(stored).toBe(computeChecksumFromContent(raw.trimEnd()));
        expect(stored).not.toBe(computeChecksumFromContent(raw));

    });

    it('should re-run a template whose data file changed but whose bytes did not', async () => {

        await writeFile(
            join(sqlDir, 'seed.json'),
            JSON.stringify({ label: 'first' }),
            'utf-8',
        );
        await writeFile(
            join(sqlDir, '001_t.sql.tmpl'),
            "SELECT '{%~ $.seed.label %}' AS label;",
            'utf-8',
        );

        expect((await runBuild(context(), sqlDir)).filesRun).toBe(1);
        expect((await runBuild(context(), sqlDir)).filesSkipped).toBe(1);

        // The template file is untouched — only its input changed. Hashing
        // raw bytes would skip this and ship stale SQL.
        await writeFile(
            join(sqlDir, 'seed.json'),
            JSON.stringify({ label: 'second' }),
            'utf-8',
        );

        const afterDataChange = await runBuild(context(), sqlDir);

        expect(afterDataChange.filesRun).toBe(1);
        expect(afterDataChange.filesSkipped).toBe(0);

    });

});
