import { describe, expect, it } from 'bun:test';
import {
    attachPolicyContext, checkConfigPolicy, getConfigPermission, getPolicyFingerprint,
    policyTargetIdentity, withPolicyConfirmation,
} from '../../../src/core/policy/index.js';
import type { ConfigAccess, PolicyContext } from '../../../src/core/policy/index.js';

function target(role: string, context: PolicyContext = {}) {

    const access: ConfigAccess = { user: role, agent: role };
    attachPolicyContext(access, context);

    return { name: 'production', access };

}

describe('policy: configurable roles', () => {

    it('should deny raw and detached access even for admin', () => {

        const protectedConfig = target('admin', { protectedStage: true });
        const detached = { ...protectedConfig, access: { ...protectedConfig.access } };
        const cloned = structuredClone(protectedConfig);
        for (const config of [detached, cloned, { name: 'production', access: { user: 'admin', agent: 'admin' } }]) {

            expect(getConfigPermission('user', config, 'sql:write')).toBe('deny');
            expect(getConfigPermission('agent', config, 'sql:ddl')).toBe('deny');

        }

    });

    it('should inherit the effective overridden built-in and default unspecified custom permissions to deny', () => {

        const context: PolicyContext = { roles: {
            operator: { permissions: { 'sql:ddl': 'confirm', 'sql:write': 'deny' } },
            deployer: { extends: 'operator', permissions: { 'run:build': 'allow' } },
            limited: { permissions: { explore: 'allow' } },
        } };
        const deployer = target('deployer', context);
        expect(getConfigPermission('user', deployer, 'sql:ddl')).toBe('confirm');
        expect(getConfigPermission('user', deployer, 'sql:write')).toBe('deny');
        expect(getConfigPermission('user', deployer, 'run:build')).toBe('allow');
        expect(getConfigPermission('user', target('limited', context), 'debug:read')).toBe('deny');
        expect(getConfigPermission('user', target('missing', context), 'debug:read')).toBe('deny');

    });

    it('should keep protected-stage ceilings immutable and per permission', () => {

        const config = target('admin', { protectedStage: true, roles: {
            viewer: { permissions: { 'sql:write': 'allow' } },
            operator: { permissions: { 'sql:ddl': 'allow', 'change:run': 'allow' } },
        } });
        expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');
        expect(getConfigPermission('user', config, 'change:run')).toBe('confirm');
        expect(getConfigPermission('agent', config, 'sql:write')).toBe('deny');

    });

    it('should not share overrides across projects with the same config name', () => {

        const strict = target('admin', { roles: { admin: { permissions: { 'sql:write': 'deny' } } } });
        const stock = target('admin');
        expect(getConfigPermission('user', strict, 'sql:write')).toBe('deny');
        expect(getConfigPermission('user', stock, 'sql:write')).toBe('allow');
        expect(getPolicyFingerprint(strict)).not.toBe(getPolicyFingerprint(stock));

    });

    it('should bind grants to both project and resolved connection', async () => {

        const first = target('operator', { targetIdentity: policyTargetIdentity('/project-a', { database: 'one' }) });
        const otherProject = target('operator', { targetIdentity: policyTargetIdentity('/project-b', { database: 'one' }) });
        const otherDatabase = target('operator', { targetIdentity: policyTargetIdentity('/project-a', { database: 'two' }) });
        await withPolicyConfirmation(first, ['change:run'], async () => {

            expect(checkConfigPolicy('agent', first, 'change:run').allowed).toBe(true);
            expect(checkConfigPolicy('agent', otherProject, 'change:run').allowed).toBe(false);
            expect(checkConfigPolicy('agent', otherDatabase, 'change:run').allowed).toBe(false);

        });

    });

    it('should limit internal grants to the exact effective config and permissions, never deny', async () => {

        const config = target('operator');
        const other = { ...config, name: 'other' };
        expect(checkConfigPolicy('agent', config, 'change:run').allowed).toBe(false);
        await withPolicyConfirmation(config, ['change:run', 'sql:ddl'], async () => {

            expect(checkConfigPolicy('agent', config, 'change:run').allowed).toBe(true);
            expect(checkConfigPolicy('agent', other, 'change:run').allowed).toBe(false);
            expect(checkConfigPolicy('agent', config, 'change:revert').allowed).toBe(false);
            expect(checkConfigPolicy('agent', config, 'sql:ddl').allowed).toBe(false);

        });
        expect(checkConfigPolicy('agent', config, 'change:run').allowed).toBe(false);

    });

    it('should cap pipeline:run at the protected-stage ceiling like the other run cells', () => {

        const roles = { runner: { permissions: { 'pipeline:run': 'allow' as const, 'run:dir': 'allow' as const } } };
        const open = target('runner', { roles });
        const guarded = target('runner', { roles, protectedStage: true });

        expect(getConfigPermission('user', open, 'pipeline:run')).toBe('allow');
        expect(getConfigPermission('user', guarded, 'pipeline:run')).toBe(getConfigPermission('user', guarded, 'run:dir'));
        expect(getConfigPermission('user', guarded, 'pipeline:run')).toBe('confirm');
        expect(getConfigPermission('agent', guarded, 'pipeline:run')).toBe('deny');

    });

});
