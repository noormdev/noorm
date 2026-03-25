/**
 * PostgreSQL error diagnostics integration test.
 *
 * Verifies that pg error properties (code, severity, where)
 * propagate through Kysely into getSqlErrorMessage output.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql, type Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';

import { createTestConnection, skipIfNoContainer } from '../../utils/db.js';
import { getSqlErrorMessage } from '../../../src/core/shared/errors.js';

describe('integration: postgres error diagnostics', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const conn = await createTestConnection('postgres');
        db = conn.db;
        destroy = conn.destroy;

    }, 30_000);

    afterAll(async () => {

        if (destroy) await destroy();

    });

    it('should include PG error code and severity for undefined table', async () => {

        const [, err] = await attempt(() =>
            sql.raw(`SELECT * FROM this_table_does_not_exist_xyz_12345`).execute(db),
        );

        expect(err).toBeTruthy();

        const message = getSqlErrorMessage(err);

        // PG error code 42P01 = undefined table
        expect(message).toContain('ERROR');
        expect(message).toContain('42P01');
        expect(message).toContain('this_table_does_not_exist_xyz_12345');

    });

    it('should include PG error code for undefined column', async () => {

        const [, err] = await attempt(() =>
            sql.raw(`SELECT nonexistent_col FROM pg_catalog.pg_tables`).execute(db),
        );

        expect(err).toBeTruthy();

        const message = getSqlErrorMessage(err);

        // PG error code 42703 = undefined column
        expect(message).toContain('ERROR');
        expect(message).toContain('42703');

    });

    it('should format error with bracketed diagnostic prefix', async () => {

        const [, err] = await attempt(() =>
            sql.raw(`SELECT 1/0`).execute(db),
        );

        expect(err).toBeTruthy();

        const message = getSqlErrorMessage(err);

        // Should have bracket-prefixed format: [ERROR 22012]
        expect(message).toMatch(/^\[ERROR 22012\]/);
        expect(message.toLowerCase()).toContain('division by zero');

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
