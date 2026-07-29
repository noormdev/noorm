/**
 * Multi-statement SQL files on SQLite.
 *
 * `executeSqlBody` handed the whole file to the driver as one statement for
 * every non-MSSQL dialect. SQLite's `prepare()` compiles only the first
 * statement and discards the rest without complaint, so a two-statement
 * file reported `status: success`, recorded its checksum, and was never
 * retried — silent, permanent data loss behind a green build.
 *
 * Postgres and MySQL are deliberately left running the body whole: both
 * execute every statement, and splitting would change the implicit
 * transaction they wrap it in.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect, sql } from 'kysely';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { runBuild } from '../../../src/core/runner/runner.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { RunContext } from '../../../src/core/runner/types.js';

describe('runner: multi-statement files on sqlite', () => {

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

    async function tableNames(): Promise<string[]> {

        const { rows } = await sql<{ name: string }>`
            SELECT name FROM sqlite_master WHERE type = 'table'
        `.execute(db);

        return rows.map((r) => r.name);

    }

    beforeEach(async () => {

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-sqlite-multi-'));
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

    it('should execute every statement in a multi-statement file', async () => {

        await writeFile(
            join(sqlDir, '001_multi.sql'),
            'CREATE TABLE multi_a (id INTEGER PRIMARY KEY);\n' +
            'CREATE TABLE multi_b (id INTEGER PRIMARY KEY);\n' +
            'CREATE TABLE multi_c (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const result = await runBuild(context(), sqlDir);

        expect(result.status).toBe('success');

        const tables = await tableNames();

        expect(tables).toContain('multi_a');
        expect(tables).toContain('multi_b');
        expect(tables).toContain('multi_c');

    });

    it('should report failure when a later statement fails', async () => {

        await writeFile(
            join(sqlDir, '001_multi.sql'),
            'CREATE TABLE multi_ok (id INTEGER PRIMARY KEY);\n' +
            'CREATE TABLE multi_ok (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const result = await runBuild(context(), sqlDir);

        // Reporting success here is what made the original defect a data
        // integrity bug: the checksum was recorded and the file never retried.
        expect(result.status).toBe('failed');
        expect(result.files[0]?.error).toContain('statement 2 of 2');

    });

    it('should not split semicolons inside a trigger body', async () => {

        await writeFile(
            join(sqlDir, '001_trigger.sql'),
            'CREATE TABLE trig_src (id INTEGER PRIMARY KEY, n INTEGER);\n' +
            'CREATE TABLE trig_log (id INTEGER PRIMARY KEY, n INTEGER);\n' +
            'CREATE TRIGGER trig_copy AFTER INSERT ON trig_src\n' +
            'BEGIN\n' +
            '    INSERT INTO trig_log (n) VALUES (NEW.n);\n' +
            '    UPDATE trig_log SET n = n + 1 WHERE n IS NULL;\n' +
            'END;\n',
            'utf-8',
        );

        const result = await runBuild(context(), sqlDir);

        expect(result.files[0]?.error).toBeUndefined();
        expect(result.status).toBe('success');

        const { rows } = await sql<{ name: string }>`
            SELECT name FROM sqlite_master WHERE type = 'trigger'
        `.execute(db);

        expect(rows.map((r) => r.name)).toContain('trig_copy');

    });

    it('should run statements around an explicit transaction block', async () => {

        await writeFile(
            join(sqlDir, '001_txn.sql'),
            'BEGIN;\n' +
            'CREATE TABLE txn_a (id INTEGER PRIMARY KEY);\n' +
            'COMMIT;\n' +
            'CREATE TABLE txn_b (id INTEGER PRIMARY KEY);\n',
            'utf-8',
        );

        const result = await runBuild(context(), sqlDir);

        expect(result.status).toBe('success');

        const tables = await tableNames();

        // `BEGIN;` is transaction control, not the start of a trigger body —
        // treating it as a block opener swallows the rest of the file.
        expect(tables).toContain('txn_a');
        expect(tables).toContain('txn_b');

    });

    it('should ignore semicolons inside string literals and comments', async () => {

        await writeFile(
            join(sqlDir, '001_quoted.sql'),
            'CREATE TABLE quoted (id INTEGER PRIMARY KEY, label TEXT);\n' +
            "INSERT INTO quoted (label) VALUES ('a;b');\n" +
            '-- a comment; with a semicolon\n' +
            '/* block; comment */\n' +
            "INSERT INTO quoted (label) VALUES ('c;d');\n",
            'utf-8',
        );

        const result = await runBuild(context(), sqlDir);

        expect(result.status).toBe('success');

        const { rows } = await sql<{ label: string }>`
            SELECT label FROM quoted ORDER BY id
        `.execute(db);

        expect(rows.map((r) => r.label)).toEqual(['a;b', 'c;d']);

    });

});
