/**
 * Unit tests for teardown operations utility functions.
 *
 * Tests pure functions that don't require database connections.
 */
import { describe, it, expect } from 'vitest';

import { isNoormTable } from '../../../src/core/teardown/index.js';


describe('teardown: operations', () => {

    describe('isNoormTable', () => {

        it('returns true for tables starting with __noorm_', () => {

            expect(isNoormTable('__noorm_custom_table')).toBe(true);
            expect(isNoormTable('__noorm_test')).toBe(true);
            expect(isNoormTable('__noorm_')).toBe(true);

        });

        it('returns true for known NOORM_TABLES values', () => {

            expect(isNoormTable('__noorm_version__')).toBe(true);
            expect(isNoormTable('__noorm_change__')).toBe(true);
            expect(isNoormTable('__noorm_executions__')).toBe(true);
            expect(isNoormTable('__noorm_lock__')).toBe(true);
            expect(isNoormTable('__noorm_identities__')).toBe(true);

        });

        it('returns false for user tables', () => {

            expect(isNoormTable('users')).toBe(false);
            expect(isNoormTable('todo_lists')).toBe(false);
            expect(isNoormTable('products')).toBe(false);
            expect(isNoormTable('orders')).toBe(false);
            expect(isNoormTable('AppSettings')).toBe(false);

        });

        it('returns false for tables containing "noorm" but not starting with __noorm_', () => {

            expect(isNoormTable('noorm_users')).toBe(false);
            expect(isNoormTable('my_noorm_table')).toBe(false);
            expect(isNoormTable('_noorm_test')).toBe(false);
            expect(isNoormTable('noorm')).toBe(false);

        });

        it('returns false for tables with __noorm prefix variations', () => {

            expect(isNoormTable('_noorm_version')).toBe(false);
            expect(isNoormTable('___noorm_version')).toBe(false);
            expect(isNoormTable('NOORM_version')).toBe(false);
            expect(isNoormTable('__NOORM_version')).toBe(false);

        });

        it('returns false for empty string', () => {

            expect(isNoormTable('')).toBe(false);

        });

        it('handles case sensitivity correctly', () => {

            // Should be case-sensitive
            expect(isNoormTable('__NOORM_version__')).toBe(false);
            expect(isNoormTable('__Noorm_version__')).toBe(false);

        });

    });


});
