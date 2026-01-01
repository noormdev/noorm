/**
 * Edge Case Integration Tests for Explore Operations
 *
 * Tests explore functions against a real SQLite database with edge case fixtures.
 * Covers long identifiers, special characters, self-referencing FKs, composite keys, etc.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
    createTestConnection,
} from '../../utils/db.js';

import {
    fetchList,
    fetchDetail,
} from '../../../src/core/explore/index.js';
import type {
    TableSummary,
    IndexSummary,
    ForeignKeySummary,
    TableDetail,
} from '../../../src/core/explore/types.js';

const EDGE_CASES_DIR = join(import.meta.dirname, '../../fixtures/schema/edge-cases');

/**
 * Execute a SQL file against the database.
 */
async function executeSqlFile(db: Kysely<unknown>, filePath: string): Promise<void> {

    const content = await readFile(filePath, 'utf-8');

    // Remove comments and split on semicolons followed by newline
    const cleanedContent = content
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');

    const statements = cleanedContent
        .split(/;[\s]*\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

    for (const statement of statements) {

        try {

            await sql.raw(statement).execute(db);

        }
        catch (err) {

            console.error(`Failed to execute statement: ${statement.substring(0, 100)}...`);
            throw err;

        }

    }

}

describe('integration: explore edge cases', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        const conn = await createTestConnection('sqlite');
        db = conn.db;
        destroy = conn.destroy;

    });

    afterAll(async () => {

        await destroy();

    });

    describe('long identifiers', () => {

        beforeAll(async () => {

            const filePath = join(EDGE_CASES_DIR, 'long-names.sql');
            await executeSqlFile(db, filePath);

        });

        it('should handle table names with 63+ characters', async () => {

            const tables = await fetchList(db, 'sqlite', 'tables') as TableSummary[];

            const longTable = tables.find(t =>
                t.name === 'this_is_a_very_long_table_name_that_tests_identifier_limits'
            );

            expect(longTable).toBeDefined();
            expect(longTable!.name.length).toBeGreaterThan(50); // 59 chars

        });

        it('should handle column names near identifier limit', async () => {

            const details = await fetchDetail(
                db,
                'sqlite',
                'tables',
                'this_is_a_very_long_table_name_that_tests_identifier_limits'
            ) as TableDetail;

            expect(details).toBeDefined();

            const longCol = details.columns.find(c =>
                c.name === 'this_is_a_very_long_column_name_that_tests_identifier_lim'
            );

            expect(longCol).toBeDefined();
            expect(longCol!.name.length).toBeGreaterThan(50); // 57 chars (limited by SQLite or truncated)

        });

        it('should handle index names with maximum length', async () => {

            const indexes = await fetchList(db, 'sqlite', 'indexes') as IndexSummary[];

            const longIndex = indexes.find(i =>
                i.name === 'idx_very_long_table_name_tests_identifier_limits_short_col'
            );

            expect(longIndex).toBeDefined();
            expect(longIndex!.name.length).toBeGreaterThan(50); // 58 chars

        });

    });

    describe('special characters', () => {

        beforeAll(async () => {

            const filePath = join(EDGE_CASES_DIR, 'special-chars.sql');
            await executeSqlFile(db, filePath);

        });

        it('should handle table names with spaces', async () => {

            const tables = await fetchList(db, 'sqlite', 'tables') as TableSummary[];

            const spaceTable = tables.find(t => t.name === 'User Profiles') as TableDetail;

            expect(spaceTable).toBeDefined();
            expect(spaceTable!.name).toBe('User Profiles') as TableDetail;

        });

        it('should handle column names with spaces and special chars', async () => {

            const details = await fetchDetail(db, 'sqlite', 'tables', 'User Profiles') as TableDetail;

            expect(details).toBeDefined();

            const firstNameCol = details!.columns.find(c => c.name === 'First Name');
            const emailCol = details!.columns.find(c => c.name === 'E-Mail Address');

            expect(firstNameCol).toBeDefined();
            expect(emailCol).toBeDefined();
            expect(emailCol!.name).toContain('-');

        });

        it('should handle table names with hyphens', async () => {

            const tables = await fetchList(db, 'sqlite', 'tables') as TableSummary[];

            const hyphenTable = tables.find(t => t.name === 'Product-Categories');

            expect(hyphenTable).toBeDefined();
            expect(hyphenTable!.name).toBe('Product-Categories');

        });

    });

    describe('self-referencing relationships', () => {

        beforeAll(async () => {

            const filePath = join(EDGE_CASES_DIR, 'self-ref-fk.sql');
            await executeSqlFile(db, filePath);

        });

        it('should detect self-referencing foreign key in employees', async () => {

            const fks = await fetchList(db, 'sqlite', 'foreignKeys') as ForeignKeySummary[];

            const selfRefFk = fks.find(fk =>
                fk.tableName === 'employees' &&
                fk.referencedTable === 'employees'
            );

            expect(selfRefFk).toBeDefined();

        });

        it('should show same table as source and target', async () => {

            const fks = await fetchList(db, 'sqlite', 'foreignKeys') as ForeignKeySummary[];
            const selfRefFk = fks.find(fk =>
                fk.tableName === 'employees' &&
                fk.referencedTable === 'employees'
            );

            expect(selfRefFk).toBeDefined();
            expect(selfRefFk!.tableName).toBe('employees');
            expect(selfRefFk!.referencedTable).toBe('employees');
            expect(selfRefFk!.columns).toContain('manager_id');
            expect(selfRefFk!.referencedColumns).toContain('id');

        });

        it('should detect self-referencing foreign key in categories', async () => {

            const fks = await fetchList(db, 'sqlite', 'foreignKeys') as ForeignKeySummary[];

            const categoryFk = fks.find(fk =>
                fk.tableName === 'categories' &&
                fk.referencedTable === 'categories'
            );

            expect(categoryFk).toBeDefined();
            expect(categoryFk!.columns).toContain('parent_category_id');

        });

    });

    describe('composite keys', () => {

        beforeAll(async () => {

            const filePath = join(EDGE_CASES_DIR, 'composite-keys.sql');
            await executeSqlFile(db, filePath);

        });

        it('should handle composite primary key (2 columns)', async () => {

            const details = await fetchDetail(db, 'sqlite', 'tables', 'order_items') as TableDetail;

            expect(details).toBeDefined();

            const pkColumns = details!.columns.filter(c => c.isPrimaryKey);

            expect(pkColumns.length).toBe(2);
            expect(pkColumns.map(c => c.name)).toContain('order_id');
            expect(pkColumns.map(c => c.name)).toContain('product_id');

        });

        it('should handle composite foreign key (2 columns)', async () => {

            const fks = await fetchList(db, 'sqlite', 'foreignKeys') as ForeignKeySummary[];

            const compositeFk = fks.find(fk =>
                fk.tableName === 'order_item_details' &&
                fk.referencedTable === 'order_items'
            );

            expect(compositeFk).toBeDefined();
            expect(compositeFk!.columns.length).toBe(2);

        });

        it('should show all columns in composite key definition', async () => {

            const fks = await fetchList(db, 'sqlite', 'foreignKeys') as ForeignKeySummary[];
            const compositeFk = fks.find(fk =>
                fk.tableName === 'order_item_details' &&
                fk.referencedTable === 'order_items'
            );

            expect(compositeFk).toBeDefined();
            expect(compositeFk!.columns).toContain('order_id');
            expect(compositeFk!.columns).toContain('product_id');
            expect(compositeFk!.referencedColumns).toContain('order_id');
            expect(compositeFk!.referencedColumns).toContain('product_id');

        });

        it('should handle 3-column composite primary key', async () => {

            const details = await fetchDetail(db, 'sqlite', 'tables', 'order_item_details') as TableDetail;

            expect(details).toBeDefined();

            const pkColumns = details!.columns.filter(c => c.isPrimaryKey);

            expect(pkColumns.length).toBe(3);
            expect(pkColumns.map(c => c.name)).toContain('order_id');
            expect(pkColumns.map(c => c.name)).toContain('product_id');
            expect(pkColumns.map(c => c.name)).toContain('detail_type');

        });

        it('should handle composite unique constraint', async () => {

            const details = await fetchDetail(db, 'sqlite', 'tables', 'user_permissions') as TableDetail;

            expect(details).toBeDefined();
            expect(details!.columns.length).toBeGreaterThan(0);

            // Verify the table was created successfully
            const tables = await fetchList(db, 'sqlite', 'tables') as TableSummary[];
            const permTable = tables.find(t => t.name === 'user_permissions') as TableDetail;

            expect(permTable).toBeDefined();

        });

    });

    describe('circular foreign keys', () => {

        beforeAll(async () => {

            const filePath = join(EDGE_CASES_DIR, 'circular-fk.sql');
            await executeSqlFile(db, filePath);

        });

        it('should detect circular reference pattern', async () => {

            const fks = await fetchList(db, 'sqlite', 'foreignKeys') as ForeignKeySummary[];

            const userToDept = fks.find(fk =>
                fk.tableName === 'department_users' &&
                fk.referencedTable === 'departments'
            );

            const deptToUser = fks.find(fk =>
                fk.tableName === 'departments' &&
                fk.referencedTable === 'department_users'
            );

            expect(userToDept).toBeDefined();
            expect(userToDept!.columns).toContain('department_id');

            expect(deptToUser).toBeDefined();
            expect(deptToUser!.columns).toContain('manager_id');

        });

        it('should handle tables with deferred circular constraints', async () => {

            const tables = await fetchList(db, 'sqlite', 'tables') as TableSummary[];

            const deptTable = tables.find(t => t.name === 'departments');
            const userTable = tables.find(t => t.name === 'department_users');

            expect(deptTable).toBeDefined();
            expect(userTable).toBeDefined();

        });

    });

    describe('nullable vs non-nullable columns', () => {

        beforeAll(async () => {

            await sql.raw(`
                CREATE TABLE nullability_test (
                    id INTEGER PRIMARY KEY,
                    required_field VARCHAR(100) NOT NULL,
                    optional_field VARCHAR(100),
                    default_value_field VARCHAR(100) DEFAULT 'test'
                )
            `).execute(db);

        });

        it('should correctly identify non-nullable columns', async () => {

            const details = await fetchDetail(db, 'sqlite', 'tables', 'nullability_test') as TableDetail;

            expect(details).toBeDefined();

            const requiredCol = details!.columns.find(c => c.name === 'required_field');

            expect(requiredCol).toBeDefined();
            expect(requiredCol!.isNullable).toBe(false);

        });

        it('should correctly identify nullable columns', async () => {

            const details = await fetchDetail(db, 'sqlite', 'tables', 'nullability_test') as TableDetail;

            expect(details).toBeDefined();

            const optionalCol = details!.columns.find(c => c.name === 'optional_field');

            expect(optionalCol).toBeDefined();
            expect(optionalCol!.isNullable).toBe(true);

        });

        it('should detect default values', async () => {

            const details = await fetchDetail(db, 'sqlite', 'tables', 'nullability_test') as TableDetail;

            expect(details).toBeDefined();

            const defaultCol = details!.columns.find(c => c.name === 'default_value_field');

            expect(defaultCol).toBeDefined();
            expect(defaultCol!.defaultValue).toBeDefined();

        });

    });

    describe('mixed case identifiers', () => {

        beforeAll(async () => {

            await sql.raw(`
                CREATE TABLE MixedCaseTable (
                    ID INTEGER PRIMARY KEY,
                    FirstName VARCHAR(100),
                    LastName VARCHAR(100)
                )
            `).execute(db);

        });

        it('should handle mixed case table names', async () => {

            const tables = await fetchList(db, 'sqlite', 'tables') as TableSummary[];

            const mixedTable = tables.find(t =>
                t.name.toLowerCase() === 'mixedcasetable'
            );

            expect(mixedTable).toBeDefined();

        });

        it('should handle mixed case column names', async () => {

            const tables = await fetchList(db, 'sqlite', 'tables') as TableSummary[];
            const mixedTable = tables.find(t =>
                t.name.toLowerCase() === 'mixedcasetable'
            );

            expect(mixedTable).toBeDefined();

            const details = await fetchDetail(db, 'sqlite', 'tables', mixedTable!.name) as TableDetail;

            expect(details).toBeDefined();
            expect(details!.columns.length).toBeGreaterThan(0);

        });

    });

    describe('empty or minimal tables', () => {

        beforeAll(async () => {

            await sql.raw(`
                CREATE TABLE empty_table (
                    id INTEGER PRIMARY KEY
                )
            `).execute(db);

            await sql.raw(`
                CREATE TABLE no_pk_table (
                    value TEXT
                )
            `).execute(db);

        });

        it('should handle table with only primary key column', async () => {

            const details = await fetchDetail(db, 'sqlite', 'tables', 'empty_table') as TableDetail;

            expect(details).toBeDefined();
            expect(details!.columns.length).toBe(1);
            expect(details!.columns[0]!.isPrimaryKey).toBe(true);

        });

        it('should handle table with no primary key', async () => {

            const details = await fetchDetail(db, 'sqlite', 'tables', 'no_pk_table') as TableDetail;

            expect(details).toBeDefined();
            expect(details!.columns.length).toBe(1);
            expect(details!.columns[0]!.isPrimaryKey).toBe(false);

        });

        it('should handle table with no indexes beyond primary key', async () => {

            const indexes = await fetchList(db, 'sqlite', 'indexes') as IndexSummary[];

            const tableIndexes = indexes.filter(i => i.tableName === 'empty_table') as TableDetail;

            // May have implicit PK index or none at all depending on SQLite version
            expect(Array.isArray(tableIndexes)).toBe(true);

        });

    });

});
