/**
 * Log timestamp formatting tests.
 *
 * Locks the exact format (not just shape) for both formatters, since
 * `output.test.ts` only regex-asserts the shape. Offset expectations are
 * derived from `Date#getTimezoneOffset()` rather than hardcoded, since the
 * host running these tests may be in any timezone.
 */
import { describe, it, expect } from 'bun:test';
import { formatLogTimestamp, formatLogTimestampIso } from '../../../src/core/logger/timestamp.js';

describe('logger: timestamp', () => {

    describe('formatLogTimestamp', () => {

        it('should format as YY-MM-DD HH:mm:ss using local time fields', () => {

            const d = new Date(2024, 0, 15, 10, 30, 5);

            expect(formatLogTimestamp(d)).toBe('24-01-15 10:30:05');

        });

        it('should zero-pad single-digit month, day, hour, minute, and second', () => {

            const d = new Date(2005, 2, 4, 1, 2, 3);

            expect(formatLogTimestamp(d)).toBe('05-03-04 01:02:03');

        });

    });

    describe('formatLogTimestampIso', () => {

        it('should format as YYYY-MM-DDTHH:mm:ss.SSS with the local UTC offset', () => {

            const d = new Date(2024, 0, 15, 10, 30, 5, 123);

            // getTimezoneOffset() is UTC-minus-local in minutes (positive when
            // local is behind UTC), so the sign is flipped relative to it.
            const offset = d.getTimezoneOffset();
            const sign = offset <= 0 ? '+' : '-';
            const absOffset = Math.abs(offset);
            const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
            const offsetMinutes = String(absOffset % 60).padStart(2, '0');

            expect(formatLogTimestampIso(d)).toBe(
                `2024-01-15T10:30:05.123${sign}${offsetHours}:${offsetMinutes}`,
            );

        });

        it('should zero-pad milliseconds to 3 digits', () => {

            const d = new Date(2024, 0, 15, 10, 30, 5, 7);

            expect(formatLogTimestampIso(d).slice(20, 23)).toBe('007');

        });

        it('should always emit a signed 2-digit:2-digit offset suffix', () => {

            const d = new Date(2024, 0, 15, 10, 30, 5, 123);

            expect(formatLogTimestampIso(d)).toMatch(/[+-]\d{2}:\d{2}$/);

        });

    });

});
