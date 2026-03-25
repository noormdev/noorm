/**
 * MSSQL error diagnostics integration test.
 *
 * Verifies that TDS error properties (line number, error code,
 * procedure name, severity) propagate through Kysely into
 * getSqlErrorMessage output.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql, type Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';

import { createTestConnection, skipIfNoContainer } from '../../utils/db.js';
import { getSqlErrorMessage } from '../../../src/core/shared/errors.js';

describe('integration: mssql error diagnostics', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        const conn = await createTestConnection('mssql');
        db = conn.db;
        destroy = conn.destroy;

    }, 30_000);

    afterAll(async () => {

        // Cleanup test objects
        await attempt(() => sql.raw(`
            IF OBJECT_ID('__noorm_err_test__') IS NOT NULL DROP TABLE __noorm_err_test__;
            IF OBJECT_ID('__noorm_test_err_proc__') IS NOT NULL DROP PROCEDURE __noorm_test_err_proc__;
        `).execute(db));

        if (destroy) await destroy();

    });

    it('should include line number and error code for invalid object', async () => {

        // Multi-line SQL with error on a specific line
        const badSql = `
            SELECT 1 AS ok
            SELECT * FROM this_table_does_not_exist_xyz_12345
        `;

        const [, err] = await attempt(() => sql.raw(badSql).execute(db));

        expect(err).toBeTruthy();

        const message = getSqlErrorMessage(err);

        // Should contain the line number from TDS
        expect(message).toContain('Line');
        // Should contain the SQL Server error code (208 = invalid object name)
        expect(message).toContain('Err 208');
        // Should still contain the original message text
        expect(message).toContain('this_table_does_not_exist_xyz_12345');

    });

    it('should include error code for constraint violations', async () => {

        // Use a real table (not temp) since connections may differ
        // Create + insert + violate PK all in one batch
        const [, err] = await attempt(() => sql.raw(`
            IF OBJECT_ID('__noorm_err_test__') IS NOT NULL DROP TABLE __noorm_err_test__;
            CREATE TABLE __noorm_err_test__ (id INT PRIMARY KEY);
            INSERT INTO __noorm_err_test__ VALUES (1);
            INSERT INTO __noorm_err_test__ VALUES (1);
        `).execute(db));

        expect(err).toBeTruthy();

        const message = getSqlErrorMessage(err);

        // Error 2627 = violation of PRIMARY KEY constraint
        expect(message).toContain('Err 2627');
        expect(message).toContain('Line');

    });

    it('should include procedure name for errors inside stored procedures', async () => {

        // Create + execute all in controlled sequence
        await sql.raw(`
            IF OBJECT_ID('__noorm_test_err_proc__') IS NOT NULL
                DROP PROCEDURE __noorm_test_err_proc__;
        `).execute(db);

        await sql.raw(`
            CREATE PROCEDURE __noorm_test_err_proc__
            AS
            BEGIN
                SELECT * FROM this_table_does_not_exist_xyz_99999;
            END
        `).execute(db);

        const [, err] = await attempt(() =>
            sql.raw(`EXEC __noorm_test_err_proc__`).execute(db),
        );

        expect(err).toBeTruthy();

        const message = getSqlErrorMessage(err);

        // Should include the procedure name in diagnostics
        expect(message).toContain('__noorm_test_err_proc__');
        expect(message).toContain('Err');

    });

    it('should include line number for column reference errors', async () => {

        // Reference a non-existent column in a real table
        // Use sys.objects which always exists
        const [, err] = await attempt(() =>
            sql.raw(`
                SELECT object_id,
                       name,
                       totally_fake_column_xyz
                FROM sys.objects
            `).execute(db),
        );

        expect(err).toBeTruthy();

        const message = getSqlErrorMessage(err);

        // Error 207 = invalid column name
        expect(message).toContain('Err 207');
        expect(message).toContain('Line');
        expect(message).toContain('totally_fake_column_xyz');

    });

    it('should format error with bracketed diagnostic prefix', async () => {

        const [, err] = await attempt(() =>
            sql.raw(`SELECT 1/0 AS oops`).execute(db),
        );

        expect(err).toBeTruthy();

        const message = getSqlErrorMessage(err);

        // Should have bracket-prefixed diagnostic format: [Line X, Err YYYY]
        expect(message).toMatch(/^\[.*\]/);
        // Error 8134 = divide by zero
        expect(message).toContain('Err 8134');
        // Case-insensitive check for the message content
        expect(message.toLowerCase()).toContain('divide by zero');

    });

    it('should produce richer output than raw .message', async () => {

        const [, err] = await attempt(() =>
            sql.raw(`SELECT * FROM nonexistent_table_for_comparison`).execute(db),
        );

        expect(err).toBeTruthy();

        const rawMessage = err instanceof Error ? err.message : String(err);
        const richMessage = getSqlErrorMessage(err);

        // The rich message should be strictly longer (has diagnostic prefix)
        expect(richMessage.length).toBeGreaterThan(rawMessage.length);
        // The raw message should be contained within the rich one
        expect(richMessage).toContain(rawMessage);

    });

});
