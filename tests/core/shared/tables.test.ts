import { describe, it, expect } from 'bun:test';
import type { Kysely } from 'kysely';

import { getNoormTables, noormDb, NOORM_TABLES } from '../../../src/core/shared/tables.js';
import type { NoormDatabase } from '../../../src/core/shared/tables.js';

describe('shared: getNoormTables', () => {

    it('should return clean names for postgres', () => {

        const tables = getNoormTables('postgres');

        expect(tables.version).toBe('version');
        expect(tables.change).toBe('change');
        expect(tables.executions).toBe('executions');
        expect(tables.lock).toBe('lock');
        expect(tables.identities).toBe('identities');
        expect(tables.vault).toBe('vault');

    });

    it('should return clean names for mssql', () => {

        const tables = getNoormTables('mssql');

        expect(tables.version).toBe('version');
        expect(tables.change).toBe('change');

    });

    it('should return prefixed names for sqlite', () => {

        const tables = getNoormTables('sqlite');

        expect(tables.version).toBe('__noorm_version__');
        expect(tables.change).toBe('__noorm_change__');
        expect(tables.executions).toBe('__noorm_executions__');
        expect(tables.lock).toBe('__noorm_lock__');
        expect(tables.identities).toBe('__noorm_identities__');
        expect(tables.vault).toBe('__noorm_vault__');

    });

    it('should return prefixed names for mysql', () => {

        const tables = getNoormTables('mysql');

        expect(tables.version).toBe('__noorm_version__');
        expect(tables.change).toBe('__noorm_change__');

    });

    it('should match NOORM_TABLES for sqlite (backward compat)', () => {

        const tables = getNoormTables('sqlite');

        expect(tables.version).toBe(NOORM_TABLES.version);
        expect(tables.change).toBe(NOORM_TABLES.change);
        expect(tables.executions).toBe(NOORM_TABLES.executions);
        expect(tables.lock).toBe(NOORM_TABLES.lock);
        expect(tables.identities).toBe(NOORM_TABLES.identities);
        expect(tables.vault).toBe(NOORM_TABLES.vault);

    });

});

describe('shared: noormDb', () => {

    it('should return db with schema for postgres', () => {

        const mockDb = { withSchema: (s: string) => ({ schema: s }) } as unknown as Kysely<NoormDatabase>;

        const result = noormDb(mockDb, 'postgres');

        expect((result as unknown as { schema: string }).schema).toBe('noorm');

    });

    it('should return db with schema for mssql', () => {

        const mockDb = { withSchema: (s: string) => ({ schema: s }) } as unknown as Kysely<NoormDatabase>;

        const result = noormDb(mockDb, 'mssql');

        expect((result as unknown as { schema: string }).schema).toBe('noorm');

    });

    it('should return plain db for sqlite', () => {

        const mockDb = { withSchema: () => ({ schema: 'nope' }) } as unknown as Kysely<NoormDatabase>;

        const result = noormDb(mockDb, 'sqlite');

        expect(result).toBe(mockDb);

    });

    it('should return plain db for mysql', () => {

        const mockDb = { withSchema: () => ({ schema: 'nope' }) } as unknown as Kysely<NoormDatabase>;

        const result = noormDb(mockDb, 'mysql');

        expect(result).toBe(mockDb);

    });

});
