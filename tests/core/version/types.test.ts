/**
 * Tests for version types.
 */
import { describe, it, expect } from 'vitest';

import {
    CURRENT_VERSIONS,
    VersionMismatchError,
    MigrationError,
} from '../../../src/core/version/types.js';

describe('version: types', () => {

    describe('CURRENT_VERSIONS', () => {

        it('should have schema version', () => {

            expect(CURRENT_VERSIONS.schema).toBe(1);

        });

        it('should have state version', () => {

            expect(CURRENT_VERSIONS.state).toBe(1);

        });

        it('should have settings version', () => {

            expect(CURRENT_VERSIONS.settings).toBe(1);

        });

        it('should be frozen (immutable)', () => {

            expect(Object.isFrozen(CURRENT_VERSIONS)).toBe(true);

        });

    });

    describe('VersionMismatchError', () => {

        it('should create error with correct message', () => {

            const error = new VersionMismatchError('schema', 5, 3);

            expect(error.message).toContain('schema version 5');
            expect(error.message).toContain('supports (3)');
            expect(error.message).toContain('upgrade noorm');

        });

        it('should store layer, current, and expected', () => {

            const error = new VersionMismatchError('state', 10, 5);

            expect(error.layer).toBe('state');
            expect(error.current).toBe(10);
            expect(error.expected).toBe(5);

        });

        it('should have correct name', () => {

            const error = new VersionMismatchError('settings', 2, 1);

            expect(error.name).toBe('VersionMismatchError');

        });

        it('should be instance of Error', () => {

            const error = new VersionMismatchError('schema', 2, 1);

            expect(error).toBeInstanceOf(Error);

        });

    });

    describe('MigrationError', () => {

        it('should create error with correct message', () => {

            const cause = new Error('column already exists');
            const error = new MigrationError('schema', 3, cause);

            expect(error.message).toContain('schema migration v3 failed');
            expect(error.message).toContain('column already exists');

        });

        it('should store layer, version, and cause', () => {

            const cause = new Error('test error');
            const error = new MigrationError('state', 2, cause);

            expect(error.layer).toBe('state');
            expect(error.version).toBe(2);
            expect(error.cause).toBe(cause);

        });

        it('should have correct name', () => {

            const cause = new Error('test');
            const error = new MigrationError('settings', 1, cause);

            expect(error.name).toBe('MigrationError');

        });

        it('should be instance of Error', () => {

            const cause = new Error('test');
            const error = new MigrationError('schema', 1, cause);

            expect(error).toBeInstanceOf(Error);

        });

    });

});
