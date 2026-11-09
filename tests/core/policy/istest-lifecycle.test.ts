/** isTest db lifecycle relaxation: docs/spec/config-access-roles.md. */
import { describe, it, expect } from 'bun:test';
import { attachPolicyContext, checkPolicy, getConfigPermission, getPolicyFingerprint } from '../../../src/core/policy/index.js';
import type { Channel, ConfigAccess, Permission, PolicyContext, Role } from '../../../src/core/policy/index.js';

const LIFECYCLE: Permission[] = ['db:create', 'db:reset', 'db:truncate', 'db:teardown', 'db:destroy'];
const CHANNELS: Channel[] = ['user', 'agent'];

function target(role: Role, context: PolicyContext) {

    const access: ConfigAccess = { user: role, agent: role };
    attachPolicyContext(access, context);

    return { name: 'test', access };

}

describe('policy: isTest database lifecycle', () => {

    for (const channel of CHANNELS) {

        for (const role of ['viewer', 'operator', 'admin'] as Role[]) {

            it(`should allow every db lifecycle permission for ${role} on ${channel}`, () => {

                const t = target(role, { isTest: true });

                for (const permission of LIFECYCLE) {

                    expect(checkPolicy(channel, t, permission)).toEqual({ allowed: true, requiresConfirmation: false });

                }

            });

        }

        it(`should allow lifecycle for a custom role that denies it on ${channel}`, () => {

            const t = target('locked', {
                isTest: true,
                roles: { locked: { permissions: { 'db:destroy': 'deny', 'db:create': 'deny' } } },
            });

            for (const permission of LIFECYCLE) {

                expect(getConfigPermission(channel, t, permission)).toBe('allow');

            }

        });

        it(`should win over a protected stage on ${channel}`, () => {

            const t = target('viewer', { isTest: true, protectedStage: true });

            for (const permission of LIFECYCLE) {

                expect(getConfigPermission(channel, t, permission)).toBe('allow');

            }

        });

    }

    it('should leave every other permission unchanged', () => {

        const t = target('viewer', { isTest: true });

        expect(getConfigPermission('agent', t, 'sql:ddl')).toBe('deny');
        expect(getConfigPermission('agent', t, 'run:build')).toBe('deny');
        expect(getConfigPermission('agent', t, 'config:rm')).toBe('deny');

    });

    it('should not relax a config that is not isTest', () => {

        const contexts: PolicyContext[] = [{ isTest: false }, {}];

        for (const context of contexts) {

            expect(getConfigPermission('user', target('admin', context), 'db:destroy')).toBe('confirm');
            expect(getConfigPermission('agent', target('viewer', context), 'db:destroy')).toBe('deny');

        }

    });

    it('should fail closed for an assigned role that resolves to nothing', () => {

        const t = target('missing', { isTest: true, roles: {} });

        expect(getConfigPermission('agent', t, 'db:destroy')).toBe('deny');
        expect(getConfigPermission('user', t, 'db:destroy')).toBe('deny');

    });

    it('should still refuse an agent-invisible config', () => {

        const access: ConfigAccess = { user: 'admin', agent: false };
        attachPolicyContext(access, { isTest: true });

        expect(checkPolicy('agent', { name: 'test', access }, 'db:destroy').allowed).toBe(false);

    });

    it('should change the fingerprint so a stale approval cannot carry over', () => {

        expect(getPolicyFingerprint(target('viewer', { isTest: true })))
            .not.toBe(getPolicyFingerprint(target('viewer', {})));

    });

});
