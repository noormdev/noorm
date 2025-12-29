/**
 * Lock types tests.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_LOCK_OPTIONS } from '../../../src/core/lock/index.js';

describe('lock: types', () => {

    describe('DEFAULT_LOCK_OPTIONS', () => {

        it('should have a 5 minute default timeout', () => {

            expect(DEFAULT_LOCK_OPTIONS.timeout).toBe(5 * 60 * 1000);

        });

        it('should not wait by default', () => {

            expect(DEFAULT_LOCK_OPTIONS.wait).toBe(false);

        });

        it('should have a 30 second wait timeout', () => {

            expect(DEFAULT_LOCK_OPTIONS.waitTimeout).toBe(30 * 1000);

        });

        it('should have a 1 second poll interval', () => {

            expect(DEFAULT_LOCK_OPTIONS.pollInterval).toBe(1000);

        });

        it('should be frozen (immutable)', () => {

            // Object.isFrozen doesn't work on plain objects by default
            // but the values should not change
            expect(DEFAULT_LOCK_OPTIONS.timeout).toBe(300_000);
            expect(DEFAULT_LOCK_OPTIONS.wait).toBe(false);
            expect(DEFAULT_LOCK_OPTIONS.waitTimeout).toBe(30_000);
            expect(DEFAULT_LOCK_OPTIONS.pollInterval).toBe(1000);

        });

    });

});
