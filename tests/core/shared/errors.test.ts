import { describe, it, expect } from 'bun:test';

import { getSqlErrorMessage } from '../../../src/core/shared/errors.js';

describe('shared: getSqlErrorMessage', () => {

    // ─────────────────────────────────────────────────────────
    // Basic error types
    // ─────────────────────────────────────────────────────────

    it('should extract message from standard Error', () => {

        const err = new Error('Something went wrong');

        expect(getSqlErrorMessage(err)).toBe('Something went wrong');

    });

    it('should return string errors as-is', () => {

        expect(getSqlErrorMessage('plain string error')).toBe('plain string error');

    });

    it('should handle unknown error type', () => {

        expect(getSqlErrorMessage(42)).toBe('Unknown error');

    });

    it('should handle null', () => {

        expect(getSqlErrorMessage(null)).toBe('Unknown error');

    });

    it('should handle object with message property', () => {

        expect(getSqlErrorMessage({ message: 'obj message' })).toBe('obj message');

    });

    // ─────────────────────────────────────────────────────────
    // MSSQL / TDS diagnostics
    // ─────────────────────────────────────────────────────────

    it('should extract MSSQL line number and error code', () => {

        const err = Object.assign(new Error('Invalid column name'), {
            number: 207,
            lineNumber: 42,
            state: 1,
            class: 16,
        });

        expect(getSqlErrorMessage(err)).toBe('[Line 42, Err 207] Invalid column name');

    });

    it('should include procedure name for MSSQL', () => {

        const err = Object.assign(new Error('Division by zero'), {
            number: 8134,
            lineNumber: 15,
            procName: 'sp_calculate',
            state: 1,
            class: 16,
        });

        expect(getSqlErrorMessage(err)).toBe('[Line 15, Err 8134, in sp_calculate] Division by zero');

    });

    it('should include severity for MSSQL system errors (class > 16)', () => {

        const err = Object.assign(new Error('Database unavailable'), {
            number: 4060,
            lineNumber: 1,
            state: 1,
            class: 20,
        });

        expect(getSqlErrorMessage(err)).toBe('[Line 1, Err 4060, Severity 20] Database unavailable');

    });

    it('should include state when > 1 for MSSQL', () => {

        const err = Object.assign(new Error('Login failed'), {
            number: 18456,
            lineNumber: 0,
            state: 8,
            class: 14,
        });

        // lineNumber 0 is not > 0, so skipped
        expect(getSqlErrorMessage(err)).toBe('[Err 18456, State 8] Login failed');

    });

    it('should handle MSSQL error with only line number', () => {

        const err = Object.assign(new Error('Syntax error'), {
            lineNumber: 7,
        });

        expect(getSqlErrorMessage(err)).toBe('[Line 7] Syntax error');

    });

    // ─────────────────────────────────────────────────────────
    // AggregateError / array handling
    // ─────────────────────────────────────────────────────────

    it('should handle AggregateError with MSSQL inner errors', () => {

        const inner1 = Object.assign(new Error('Column does not exist'), {
            number: 207,
            lineNumber: 10,
            state: 1,
            class: 16,
        });
        const inner2 = Object.assign(new Error('Invalid object'), {
            number: 208,
            lineNumber: 15,
            state: 1,
            class: 16,
        });

        const agg = new AggregateError([inner1, inner2], 'Multiple errors');

        const result = getSqlErrorMessage(agg);
        const lines = result.split('\n');

        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe('[Line 10, Err 207] Column does not exist');
        expect(lines[1]).toBe('[Line 15, Err 208] Invalid object');

    });

    it('should handle array of errors (Kysely unpacked AggregateError)', () => {

        const inner1 = Object.assign(new Error('Error one'), {
            number: 100,
            lineNumber: 5,
            state: 1,
            class: 16,
        });
        const inner2 = Object.assign(new Error('Error two'), {
            number: 200,
            lineNumber: 12,
            state: 1,
            class: 16,
        });

        const result = getSqlErrorMessage([inner1, inner2]);
        const lines = result.split('\n');

        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe('[Line 5, Err 100] Error one');
        expect(lines[1]).toBe('[Line 12, Err 200] Error two');

    });

    it('should handle errors[] property on object', () => {

        const inner = Object.assign(new Error('Nested'), {
            number: 300,
            lineNumber: 1,
            state: 1,
            class: 16,
        });
        const wrapped = { errors: [inner] };

        expect(getSqlErrorMessage(wrapped)).toBe('[Line 1, Err 300] Nested');

    });

    // ─────────────────────────────────────────────────────────
    // PostgreSQL diagnostics
    // ─────────────────────────────────────────────────────────

    it('should extract PostgreSQL error code and severity', () => {

        const err = Object.assign(new Error('relation "users" does not exist'), {
            code: '42P01',
            severity: 'ERROR',
        });

        expect(getSqlErrorMessage(err)).toBe('[ERROR 42P01] relation "users" does not exist');

    });

    it('should include PostgreSQL where clause', () => {

        const err = Object.assign(new Error('division by zero'), {
            code: '22012',
            severity: 'ERROR',
            where: 'PL/pgSQL function my_func() line 5 at assignment',
        });

        expect(getSqlErrorMessage(err)).toBe(
            '[ERROR 22012 - PL/pgSQL function my_func() line 5 at assignment] division by zero',
        );

    });

    // ─────────────────────────────────────────────────────────
    // MySQL diagnostics
    // ─────────────────────────────────────────────────────────

    it('should extract MySQL errno', () => {

        const err = Object.assign(new Error("Unknown column 'email'"), {
            errno: 1054,
            sqlState: '42S22',
        });

        expect(getSqlErrorMessage(err)).toBe("[Err 1054, State 42S22] Unknown column 'email'");

    });

    it('should handle MySQL error without sqlState', () => {

        const err = Object.assign(new Error('Table already exists'), {
            errno: 1050,
        });

        expect(getSqlErrorMessage(err)).toBe('[Err 1050] Table already exists');

    });

    // ─────────────────────────────────────────────────────────
    // originalError passthrough
    // ─────────────────────────────────────────────────────────

    it('should recurse into originalError with diagnostics', () => {

        const original = Object.assign(new Error('Constraint violation'), {
            number: 2627,
            lineNumber: 3,
            state: 1,
            class: 14,
        });
        const wrapper = { originalError: original };

        expect(getSqlErrorMessage(wrapper)).toBe('[Line 3, Err 2627] Constraint violation');

    });

    // ─────────────────────────────────────────────────────────
    // Edge cases
    // ─────────────────────────────────────────────────────────

    it('should handle plain Error without driver properties', () => {

        const err = new Error('Something generic');

        expect(getSqlErrorMessage(err)).toBe('Something generic');

    });

    it('should handle empty AggregateError', () => {

        const agg = new AggregateError([], 'Empty');

        // Falls through to Error branch since errors.length === 0
        expect(getSqlErrorMessage(agg)).toBe('Empty');

    });

    it('should handle empty array', () => {

        // Empty arrays fall through to object branch, String([]) = ""
        expect(getSqlErrorMessage([])).toBe('');

    });

});
