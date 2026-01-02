import { describe, it, expect } from 'vitest';

import { formatSummaryDescription } from '../../../src/core/explore/index.js';
import type {
    TableSummary,
    ViewSummary,
    ProcedureSummary,
    FunctionSummary,
    TypeSummary,
    IndexSummary,
    ForeignKeySummary,
} from '../../../src/core/explore/types.js';

describe('explore: operations', () => {

    describe('formatSummaryDescription', () => {

        describe('tables', () => {

            it('should format table with columns only', () => {

                const table: TableSummary = {
                    name: 'users',
                    columnCount: 5,
                };

                const result = formatSummaryDescription('tables', table);

                expect(result).toBe('5 columns');

            });

            it('should format table with columns and row count', () => {

                const table: TableSummary = {
                    name: 'users',
                    columnCount: 5,
                    rowCountEstimate: 1234,
                };

                const result = formatSummaryDescription('tables', table);

                expect(result).toBe('5 columns, ~1.2K rows');

            });

            it('should format table with large row count (millions)', () => {

                const table: TableSummary = {
                    name: 'events',
                    columnCount: 10,
                    rowCountEstimate: 5_500_000,
                };

                const result = formatSummaryDescription('tables', table);

                expect(result).toBe('10 columns, ~5.5M rows');

            });

            it('should format table with small row count (under 1000)', () => {

                const table: TableSummary = {
                    name: 'admins',
                    columnCount: 3,
                    rowCountEstimate: 42,
                };

                const result = formatSummaryDescription('tables', table);

                expect(result).toBe('3 columns, ~42 rows');

            });

            it('should handle zero columns', () => {

                const table: TableSummary = {
                    name: 'empty',
                    columnCount: 0,
                };

                const result = formatSummaryDescription('tables', table);

                expect(result).toBe('0 columns');

            });

            it('should handle zero rows', () => {

                const table: TableSummary = {
                    name: 'empty',
                    columnCount: 5,
                    rowCountEstimate: 0,
                };

                const result = formatSummaryDescription('tables', table);

                expect(result).toBe('5 columns, ~0 rows');

            });

            it('should format exactly 1000 rows as K', () => {

                const table: TableSummary = {
                    name: 'products',
                    columnCount: 8,
                    rowCountEstimate: 1_000,
                };

                const result = formatSummaryDescription('tables', table);

                expect(result).toBe('8 columns, ~1.0K rows');

            });

            it('should format exactly 1000000 rows as M', () => {

                const table: TableSummary = {
                    name: 'logs',
                    columnCount: 15,
                    rowCountEstimate: 1_000_000,
                };

                const result = formatSummaryDescription('tables', table);

                expect(result).toBe('15 columns, ~1.0M rows');

            });

        });

        describe('views', () => {

            it('should format non-updatable view', () => {

                const view: ViewSummary = {
                    name: 'user_summary',
                    columnCount: 3,
                    isUpdatable: false,
                };

                const result = formatSummaryDescription('views', view);

                expect(result).toBe('3 columns');

            });

            it('should format updatable view', () => {

                const view: ViewSummary = {
                    name: 'active_users',
                    columnCount: 5,
                    isUpdatable: true,
                };

                const result = formatSummaryDescription('views', view);

                expect(result).toBe('5 columns, updatable');

            });

            it('should handle zero columns', () => {

                const view: ViewSummary = {
                    name: 'empty_view',
                    columnCount: 0,
                    isUpdatable: false,
                };

                const result = formatSummaryDescription('views', view);

                expect(result).toBe('0 columns');

            });

            it('should handle single column updatable view', () => {

                const view: ViewSummary = {
                    name: 'single_col',
                    columnCount: 1,
                    isUpdatable: true,
                };

                const result = formatSummaryDescription('views', view);

                expect(result).toBe('1 columns, updatable');

            });

        });

        describe('procedures', () => {

            it('should format procedure with no parameters', () => {

                const proc: ProcedureSummary = {
                    name: 'refresh_stats',
                    parameterCount: 0,
                };

                const result = formatSummaryDescription('procedures', proc);

                expect(result).toBe('0 parameters');

            });

            it('should format procedure with parameters', () => {

                const proc: ProcedureSummary = {
                    name: 'create_user',
                    parameterCount: 3,
                };

                const result = formatSummaryDescription('procedures', proc);

                expect(result).toBe('3 parameters');

            });

            it('should format procedure with single parameter', () => {

                const proc: ProcedureSummary = {
                    name: 'delete_user',
                    parameterCount: 1,
                };

                const result = formatSummaryDescription('procedures', proc);

                expect(result).toBe('1 parameters');

            });

            it('should format procedure with many parameters', () => {

                const proc: ProcedureSummary = {
                    name: 'complex_operation',
                    parameterCount: 15,
                };

                const result = formatSummaryDescription('procedures', proc);

                expect(result).toBe('15 parameters');

            });

        });

        describe('functions', () => {

            it('should format function with no parameters', () => {

                const fn: FunctionSummary = {
                    name: 'get_current_timestamp',
                    parameterCount: 0,
                    returnType: 'timestamp',
                };

                const result = formatSummaryDescription('functions', fn);

                expect(result).toBe('0 params → timestamp');

            });

            it('should format function with parameters', () => {

                const fn: FunctionSummary = {
                    name: 'calculate_total',
                    parameterCount: 2,
                    returnType: 'decimal',
                };

                const result = formatSummaryDescription('functions', fn);

                expect(result).toBe('2 params → decimal');

            });

            it('should format function with complex return type', () => {

                const fn: FunctionSummary = {
                    name: 'get_user',
                    parameterCount: 1,
                    returnType: 'TABLE(id int, name varchar)',
                };

                const result = formatSummaryDescription('functions', fn);

                expect(result).toBe('1 params → TABLE(id int, name varchar)');

            });

            it('should format function with void return', () => {

                const fn: FunctionSummary = {
                    name: 'log_event',
                    parameterCount: 3,
                    returnType: 'void',
                };

                const result = formatSummaryDescription('functions', fn);

                expect(result).toBe('3 params → void');

            });

        });

        describe('types', () => {

            it('should format enum type with value count', () => {

                const type: TypeSummary = {
                    name: 'user_role',
                    kind: 'enum',
                    valueCount: 3,
                };

                const result = formatSummaryDescription('types', type);

                expect(result).toBe('enum (3 values)');

            });

            it('should format enum type without value count', () => {

                const type: TypeSummary = {
                    name: 'status',
                    kind: 'enum',
                };

                const result = formatSummaryDescription('types', type);

                expect(result).toBe('enum');

            });

            it('should format composite type', () => {

                const type: TypeSummary = {
                    name: 'address',
                    kind: 'composite',
                };

                const result = formatSummaryDescription('types', type);

                expect(result).toBe('composite');

            });

            it('should format domain type', () => {

                const type: TypeSummary = {
                    name: 'email',
                    kind: 'domain',
                };

                const result = formatSummaryDescription('types', type);

                expect(result).toBe('domain');

            });

            it('should format other type', () => {

                const type: TypeSummary = {
                    name: 'custom',
                    kind: 'other',
                };

                const result = formatSummaryDescription('types', type);

                expect(result).toBe('other');

            });

            it('should format enum with zero values', () => {

                const type: TypeSummary = {
                    name: 'empty_enum',
                    kind: 'enum',
                    valueCount: 0,
                };

                const result = formatSummaryDescription('types', type);

                expect(result).toBe('enum (0 values)');

            });

            it('should format enum with many values', () => {

                const type: TypeSummary = {
                    name: 'country_code',
                    kind: 'enum',
                    valueCount: 195,
                };

                const result = formatSummaryDescription('types', type);

                expect(result).toBe('enum (195 values)');

            });

        });

        describe('indexes', () => {

            it('should format regular index', () => {

                const index: IndexSummary = {
                    name: 'idx_users_email',
                    tableName: 'users',
                    columns: ['email'],
                    isUnique: false,
                    isPrimary: false,
                };

                const result = formatSummaryDescription('indexes', index);

                expect(result).toBe('on users');

            });

            it('should format primary key index', () => {

                const index: IndexSummary = {
                    name: 'pk_users',
                    tableName: 'users',
                    columns: ['id'],
                    isUnique: true,
                    isPrimary: true,
                };

                const result = formatSummaryDescription('indexes', index);

                expect(result).toBe('on users, PRIMARY');

            });

            it('should format unique index', () => {

                const index: IndexSummary = {
                    name: 'uq_users_email',
                    tableName: 'users',
                    columns: ['email'],
                    isUnique: true,
                    isPrimary: false,
                };

                const result = formatSummaryDescription('indexes', index);

                expect(result).toBe('on users, UNIQUE');

            });

            it('should prioritize PRIMARY over UNIQUE when both are true', () => {

                const index: IndexSummary = {
                    name: 'pk_users',
                    tableName: 'users',
                    columns: ['id'],
                    isUnique: true,
                    isPrimary: true,
                };

                const result = formatSummaryDescription('indexes', index);

                expect(result).toBe('on users, PRIMARY');

            });

            it('should handle index on table with schema', () => {

                const index: IndexSummary = {
                    name: 'idx_products_sku',
                    tableName: 'products',
                    tableSchema: 'inventory',
                    columns: ['sku'],
                    isUnique: false,
                    isPrimary: false,
                };

                const result = formatSummaryDescription('indexes', index);

                expect(result).toBe('on products');

            });

        });

        describe('foreignKeys', () => {

            it('should format foreign key', () => {

                const fk: ForeignKeySummary = {
                    name: 'fk_orders_user',
                    tableName: 'orders',
                    columns: ['user_id'],
                    referencedTable: 'users',
                    referencedColumns: ['id'],
                };

                const result = formatSummaryDescription('foreignKeys', fk);

                expect(result).toBe('orders → users');

            });

            it('should format foreign key with schema', () => {

                const fk: ForeignKeySummary = {
                    name: 'fk_orders_user',
                    tableName: 'orders',
                    tableSchema: 'sales',
                    columns: ['user_id'],
                    referencedTable: 'users',
                    referencedSchema: 'auth',
                    referencedColumns: ['id'],
                };

                const result = formatSummaryDescription('foreignKeys', fk);

                expect(result).toBe('orders → users');

            });

            it('should format foreign key with cascade rules', () => {

                const fk: ForeignKeySummary = {
                    name: 'fk_comments_post',
                    tableName: 'comments',
                    columns: ['post_id'],
                    referencedTable: 'posts',
                    referencedColumns: ['id'],
                    onDelete: 'CASCADE',
                    onUpdate: 'CASCADE',
                };

                const result = formatSummaryDescription('foreignKeys', fk);

                expect(result).toBe('comments → posts');

            });

            it('should format foreign key with multiple columns', () => {

                const fk: ForeignKeySummary = {
                    name: 'fk_order_items',
                    tableName: 'order_items',
                    columns: ['order_id', 'product_id'],
                    referencedTable: 'products',
                    referencedColumns: ['order_id', 'id'],
                };

                const result = formatSummaryDescription('foreignKeys', fk);

                expect(result).toBe('order_items → products');

            });

        });

        describe('edge cases', () => {

            it('should return empty string for unknown category', () => {

                const result = formatSummaryDescription('unknown', {});

                expect(result).toBe('');

            });

            it('should handle undefined item properties gracefully', () => {

                const table: Partial<TableSummary> = {
                    name: 'test',
                };

                const result = formatSummaryDescription('tables', table);

                expect(result).toContain('columns');

            });

        });

    });

});
