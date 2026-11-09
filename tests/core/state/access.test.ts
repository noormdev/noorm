import { describe, it, expect } from 'bun:test';
import { resolveStateConfigAccess } from '../../../src/core/state/access.js';
import { GUARDED_ACCESS, DEFAULT_ACCESS } from '../../../src/core/policy/index.js';

describe('state: config access', () => {

    it('maps absent access from the legacy protected flag', () => {

        expect(resolveStateConfigAccess(undefined, true)).toEqual(GUARDED_ACCESS);
        expect(resolveStateConfigAccess(undefined, 'true')).toEqual(GUARDED_ACCESS);
        expect(resolveStateConfigAccess(undefined, 1)).toEqual(GUARDED_ACCESS);
        expect(resolveStateConfigAccess(undefined, false)).toEqual(DEFAULT_ACCESS);
        expect(resolveStateConfigAccess(undefined, undefined)).toEqual(DEFAULT_ACCESS);

    });

    it('preserves explicitly configured built-in and custom roles', () => {

        expect(resolveStateConfigAccess({ user: 'operator', agent: 'viewer' }, true))
            .toEqual({ user: 'operator', agent: 'viewer' });
        expect(resolveStateConfigAccess({ user: 'auditor', agent: false }, true))
            .toEqual({ user: 'auditor', agent: false });
        expect(resolveStateConfigAccess({ user: 'superuser', agent: 'automation' }, undefined))
            .toEqual({ user: 'superuser', agent: 'automation' });

    });

    it('rejects malformed explicit access instead of substituting a role', () => {

        for (const access of [null, false, 42, 'admin', [], {}, { user: 'admin' },
            { agent: 'viewer' }, { user: '', agent: 'viewer' },
            { user: 'admin', agent: '  ' }, { user: false, agent: 'viewer' },
            { user: 'admin', agent: null }]) {

            expect(() => resolveStateConfigAccess(access, true)).toThrow('Invalid config access');

        }

    });

});
