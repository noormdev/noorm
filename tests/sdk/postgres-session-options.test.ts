import { describe, expect, it } from 'bun:test';
import { ConnectionSchema } from '../../src/core/config/schema.js';

describe('PostgreSQL session options', () => {

    const connection = { dialect: 'postgres', host: 'localhost', database: 'app' };
    it('retains typed settings and zero values', () => {

        const parsed = ConnectionSchema.parse({ ...connection, pool: { idleTimeoutMillis: 0 }, statementTimeoutMs: 1000, queryTimeoutMs: 0, applicationName: 'worker', keepAlive: false });
        expect(parsed.pool?.idleTimeoutMillis).toBe(0);
        expect(parsed.statementTimeoutMs).toBe(1000);
        expect(parsed.queryTimeoutMs).toBe(0);
        expect(parsed.applicationName).toBe('worker');
        expect(parsed.keepAlive).toBe(false);

    });
    it('rejects negative and fractional timeouts', () => {

        expect(() => ConnectionSchema.parse({ ...connection, statementTimeoutMs: -1 })).toThrow();
        expect(() => ConnectionSchema.parse({ ...connection, pool: { idleTimeoutMillis: 0.5 } })).toThrow();

    });

});
