import { describe, it, expect } from 'bun:test';

import { filterData, isMaskedField } from '../../../src/core/logger/redact.js';

/**
 * The A11 audit's `redact-probe.ts` found redaction to be name-only, matching
 * against a pre-enumerated variant set. It therefore missed:
 *
 * 1. This project's OWN documented env vars — `addMaskedFields` only generates a
 *    `noorm_` prefix on the *bare* term, so `noorm_password` was covered but
 *    `NOORM_CONNECTION_PASSWORD` was not.
 * 2. Every value-borne secret. A DSN passes verbatim under any key name, because
 *    values were never inspected at all.
 * 3. `Error` objects, skipped wholesale — and connection errors routinely carry
 *    a DSN in their message.
 */
describe('logger: redact coverage', () => {

    describe('project environment variable names', () => {

        it('should mask the connection password env var', () => {

            expect(isMaskedField('NOORM_CONNECTION_PASSWORD')).toBe(true);

        });

        it('should mask the identity private key env var', () => {

            expect(isMaskedField('NOORM_IDENTITY_PRIVATE_KEY')).toBe(true);

        });

        it('should mask the camelCase forms used in code', () => {

            expect(isMaskedField('connectionPassword')).toBe(true);
            expect(isMaskedField('userPassword')).toBe(true);
            expect(isMaskedField('passwordHash')).toBe(true);

        });

        it('should mask values under those keys, not just recognise the name', () => {

            const filtered = filterData(
                { NOORM_CONNECTION_PASSWORD: 'hunter2-in-the-clear' },
                'info',
            );

            expect(filtered['NOORM_CONNECTION_PASSWORD']).not.toContain('hunter2');

        });

    });

    describe('credential-bearing values', () => {

        it('should strip the password from a DSN regardless of key name', () => {

            const filtered = filterData(
                { connectionString: 'postgres://user:hunter2@db.example.com:5432/app' },
                'info',
            );

            const value = String(filtered['connectionString']);

            expect(value).not.toContain('hunter2');
            // The non-secret parts stay readable — a redacted DSN is still the
            // most useful thing in a connection-failure log.
            expect(value).toContain('db.example.com');

        });

        it('should strip credentials under an innocuous key like url', () => {

            const filtered = filterData(
                { url: 'mysql://root:s3cr3t@127.0.0.1:3306/noorm' },
                'info',
            );

            expect(String(filtered['url'])).not.toContain('s3cr3t');

        });

        it('should strip credentials nested inside objects and arrays', () => {

            const filtered = filterData(
                {
                    targets: [{ dsn: 'postgres://u:leaked-pw@host/db' }],
                },
                'info',
            );

            expect(JSON.stringify(filtered)).not.toContain('leaked-pw');

        });

        it('should leave credential-free strings untouched', () => {

            const filtered = filterData(
                { url: 'https://github.com/noormdev/noorm', note: 'no secrets here' },
                'info',
            );

            expect(filtered['url']).toBe('https://github.com/noormdev/noorm');
            expect(filtered['note']).toBe('no secrets here');

        });

    });

    describe('Error objects', () => {

        it('should redact a DSN carried in an error message', () => {

            const err = new Error('connect failed: postgres://user:hunter2@host/db');

            const filtered = filterData({ error: err }, 'info');
            const out = filtered['error'] as Error;

            expect(out.message).not.toContain('hunter2');
            expect(out.message).toContain('connect failed');

        });

        it('should keep the value an Error so callers can still branch on it', () => {

            const err = new TypeError('bad dsn postgres://u:pw@h/d');

            const out = filterData({ error: err }, 'info')['error'] as Error;

            expect(out).toBeInstanceOf(Error);
            expect(out).toBeInstanceOf(TypeError);
            expect(out.name).toBe('TypeError');

        });

        it('should not mutate the original error', () => {

            const err = new Error('postgres://u:originalpw@h/d');

            filterData({ error: err }, 'info');

            expect(err.message).toContain('originalpw');

        });

        it('should redact the stack trace too', () => {

            const err = new Error('boom');
            err.stack = 'Error: boom\n    at connect (postgres://u:stackpw@h/d)';

            const out = filterData({ error: err }, 'info')['error'] as Error;

            expect(out.stack).not.toContain('stackpw');

        });

    });

});
