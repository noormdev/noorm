/**
 * Config access repair tests.
 *
 * The invariant: a config must never come out of migration or load-time
 * repair *more* permissive than what it went in as. An unrecognised shape
 * is a reason to restrict, not a reason to fall back to full admin.
 */
import { describe, it, expect } from 'bun:test';
import { repairConfigAccess } from '../../../src/core/state/access.js';
import { GUARDED_ACCESS, DEFAULT_ACCESS } from '../../../src/core/policy/index.js';

describe('state: access repair', () => {

    describe('legacy protected flag', () => {

        it('should map protected:true to guarded access', () => {

            expect(repairConfigAccess(undefined, true)).toEqual(GUARDED_ACCESS);

        });

        it('should map protected:false to open access', () => {

            expect(repairConfigAccess(undefined, false)).toEqual(DEFAULT_ACCESS);

        });

        it('should map an absent protected flag to open access', () => {

            expect(repairConfigAccess(undefined, undefined)).toEqual(DEFAULT_ACCESS);

        });

        it('should treat a truthy non-boolean protected as guarded, not open', () => {

            // A state file written outside the zod path can carry a string
            // or a number here. Requiring a strict `true` made every one of
            // those fall through to the admin/admin default — the exact
            // opposite of the fail-closed behaviour the code claims.
            expect(repairConfigAccess(undefined, 'true')).toEqual(GUARDED_ACCESS);
            expect(repairConfigAccess(undefined, 1)).toEqual(GUARDED_ACCESS);
            expect(repairConfigAccess(undefined, 'yes')).toEqual(GUARDED_ACCESS);

        });

        it('should treat a falsy non-boolean protected as open', () => {

            expect(repairConfigAccess(undefined, 0)).toEqual(DEFAULT_ACCESS);
            expect(repairConfigAccess(undefined, '')).toEqual(DEFAULT_ACCESS);
            expect(repairConfigAccess(undefined, null)).toEqual(DEFAULT_ACCESS);

        });

    });

    describe('explicit access', () => {

        it('should keep a fully valid access untouched', () => {

            expect(repairConfigAccess({ user: 'operator', mcp: 'viewer' }, true))
                .toEqual({ user: 'operator', mcp: 'viewer' });

        });

        it('should keep mcp:false, which hides the config rather than widening it', () => {

            expect(repairConfigAccess({ user: 'viewer', mcp: false }, undefined))
                .toEqual({ user: 'viewer', mcp: false });

        });

        it('should let a valid access win over the legacy flag', () => {

            expect(repairConfigAccess({ user: 'admin', mcp: 'admin' }, true))
                .toEqual({ user: 'admin', mcp: 'admin' });

        });

    });

    describe('malformed access', () => {

        it('should restrict an empty access rather than leaving it unusable', () => {

            // `{}` is truthy, so it used to pass straight through and brick
            // the config: every later command failed zod validation with
            // `expected one of "viewer"|"operator"|"admin"`.
            expect(repairConfigAccess({}, true)).toEqual({ user: 'viewer', mcp: 'viewer' });

        });

        it('should fill a missing channel with the most restrictive role', () => {

            expect(repairConfigAccess({ user: 'admin' }, undefined))
                .toEqual({ user: 'admin', mcp: 'viewer' });

        });

        it('should replace an unrecognised role with the most restrictive one', () => {

            expect(repairConfigAccess({ user: 'superuser', mcp: 'admin' }, undefined))
                .toEqual({ user: 'viewer', mcp: 'admin' });

        });

        it('should never widen a config whose access is malformed', () => {

            for (const malformed of [{}, { user: 'nope' }, { mcp: 'nope' }, { user: null }]) {

                const repaired = repairConfigAccess(malformed, undefined);

                expect({ input: malformed, access: repaired })
                    .not.toEqual({ input: malformed, access: DEFAULT_ACCESS });

            }

        });

        it('should restrict when access is present but not an object', () => {

            expect(repairConfigAccess('admin', undefined)).toEqual(DEFAULT_ACCESS);
            expect(repairConfigAccess(42, true)).toEqual(GUARDED_ACCESS);

        });

    });

});
