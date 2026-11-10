/** A role that cannot record to the tracking tables must never be counted as one that may create or migrate them. */
import { describe, it, expect } from 'bun:test';

import { attachPolicyContext, MATRIX, mayWriteTracking, RECORDS_TO_TRACKING, TRACKED_WRITES, withPolicyConfirmation } from '../../../src/core/policy/index.js';
import type { ConfigAccess, Permission, RoleDefinition } from '../../../src/core/policy/index.js';

function configWith(permissions: RoleDefinition['permissions'], access: ConfigAccess = { user: 'custom', agent: 'custom' }) {

    attachPolicyContext(access, { roles: { custom: { permissions } } });

    return { name: 'acme', access };

}

describe('policy: tracked writes', () => {

    it('should classify every matrix permission as recording to the tracking tables or not', () => {

        expect(Object.keys(RECORDS_TO_TRACKING).sort()).toEqual(Object.keys(MATRIX).sort());

    });

    it('should count the permissions whose operations write a tracking row', () => {

        const expected: Permission[] = [
            'change:run', 'change:ff', 'change:revert', 'change:rm',
            'run:build', 'run:file', 'run:dir', 'pipeline:run',
            'db:create', 'db:reset', 'db:teardown',
            'vault:read', 'vault:write', 'vault:propagate', 'lock:acquire', 'lock:force', 'debug:write',
        ];

        expect([...TRACKED_WRITES].sort()).toEqual([...expected].sort());

    });

    it.each(['db:teardown', 'db:create'] as const)('should count a role holding only %s as a writer', (permission) => {

        expect(mayWriteTracking('user', configWith({ [permission]: 'allow' }))).toBe(true);

    });

    it('should count a confirm cell as writable on the user channel only', () => {

        const config = configWith({ 'run:build': 'confirm' });

        expect(mayWriteTracking('user', config)).toBe(true);
        expect(mayWriteTracking('agent', config)).toBe(false);

    });

    it('should count an agent whose confirm cell a human approved', async () => {

        const config = configWith({ 'run:build': 'confirm' });

        await withPolicyConfirmation(config, ['run:build'], async () => {

            expect(mayWriteTracking('agent', config)).toBe(true);

        });

    });

    it('should not count a config hidden from the agent channel', () => {

        const config = configWith({ 'run:build': 'allow' }, { user: 'custom', agent: false });

        expect(mayWriteTracking('agent', config)).toBe(false);

    });

    it('should not count a role that only reads', () => {

        expect(mayWriteTracking('user', configWith({ 'explore': 'allow', 'secret:read': 'allow', 'db:truncate': 'allow' }))).toBe(false);

    });

    // Propagation shares the vault key with registered identities only, so a reader has to be registered.
    it('should count a role that only reads the vault', () => {

        expect(mayWriteTracking('user', configWith({ 'vault:read': 'allow' }))).toBe(true);

    });

});
