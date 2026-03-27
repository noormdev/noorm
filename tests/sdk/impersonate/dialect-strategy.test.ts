/**
 * Dialect strategy tests.
 *
 * Verifies SQL generation and username validation for each
 * supported dialect's impersonation strategy.
 */
import { describe, it, expect } from 'bun:test';

import { dialectStrategy, validateUsername } from '../../../src/sdk/impersonate/dialect-strategy.js';
import { ImpersonationError } from '../../../src/sdk/impersonate/types.js';

// ─────────────────────────────────────────────────────────────
// Username Validation
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate validateUsername', () => {

    it('should accept alphanumeric usernames', () => {

        expect(() => validateUsername('john_doe')).not.toThrow();

    });

    it('should accept usernames with @ . - \\', () => {

        expect(() => validateUsername('john@domain.com')).not.toThrow();
        expect(() => validateUsername('DOMAIN\\user')).not.toThrow();
        expect(() => validateUsername('first-last')).not.toThrow();

    });

    it('should reject usernames with single quotes', () => {

        expect(() => validateUsername("admin'; DROP TABLE users;--")).toThrow(ImpersonationError);

    });

    it('should reject usernames with semicolons', () => {

        expect(() => validateUsername('user;evil')).toThrow(ImpersonationError);

    });

    it('should reject empty usernames', () => {

        expect(() => validateUsername('')).toThrow(ImpersonationError);

    });

});

// ─────────────────────────────────────────────────────────────
// MSSQL Strategy
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate dialectStrategy mssql', () => {

    const strategy = dialectStrategy.mssql;

    it('should exist', () => {

        expect(strategy).not.toBeNull();

    });

    it('should generate EXECUTE AS USER SQL', () => {

        const sql = strategy!.impersonate('testuser');

        expect(sql).toBe("EXECUTE AS USER = 'testuser'");

    });

    it('should generate REVERT SQL', () => {

        expect(strategy!.revert()).toBe('REVERT');

    });

    it('should escape single quotes in username', () => {

        const sql = strategy!.impersonate("user'name");

        expect(sql).toBe("EXECUTE AS USER = 'user''name'");

    });

});

// ─────────────────────────────────────────────────────────────
// PostgreSQL Strategy
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate dialectStrategy postgres', () => {

    const strategy = dialectStrategy.postgres;

    it('should exist', () => {

        expect(strategy).not.toBeNull();

    });

    it('should generate SET ROLE SQL', () => {

        const sql = strategy!.impersonate('testuser');

        expect(sql).toBe("SET ROLE 'testuser'");

    });

    it('should generate RESET ROLE SQL', () => {

        expect(strategy!.revert()).toBe('RESET ROLE');

    });

    it('should escape single quotes in username', () => {

        const sql = strategy!.impersonate("user'name");

        expect(sql).toBe("SET ROLE 'user''name'");

    });

});

// ─────────────────────────────────────────────────────────────
// Unsupported Dialects
// ─────────────────────────────────────────────────────────────

describe('sdk: impersonate dialectStrategy unsupported', () => {

    it('should return null for mysql', () => {

        expect(dialectStrategy.mysql).toBeNull();

    });

    it('should return null for sqlite', () => {

        expect(dialectStrategy.sqlite).toBeNull();

    });

});
