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

describe('configurable role policy', () => {

    it('inherits the effective overridden built-in and defaults unspecified custom permissions to deny', () => {

        const context: PolicyContext = { roles: {
            operator: { permissions: { 'sql:read': 'confirm', 'sql:write': 'deny' } },
            deployer: { extends: 'operator', permissions: { 'run:build': 'allow' } },
            limited: { permissions: { explore: 'allow' } },
        } };
        const deployer = target('deployer', context);
        expect(getConfigPermission('user', deployer, 'sql:read')).toBe('confirm');
        expect(getConfigPermission('user', deployer, 'sql:write')).toBe('deny');
        expect(getConfigPermission('user', deployer, 'run:build')).toBe('allow');
        expect(getConfigPermission('user', target('limited', context), 'sql:read')).toBe('deny');
        expect(getConfigPermission('user', target('missing', context), 'explore')).toBe('deny');

    });

    it('keeps protected-stage ceilings immutable and per permission', () => {

        const config = target('admin', { protectedStage: true, roles: {
            viewer: { permissions: { 'sql:write': 'allow' } },
            operator: { permissions: { 'sql:ddl': 'allow', 'change:run': 'allow' } },
        } });
        expect(getConfigPermission('user', config, 'sql:ddl')).toBe('deny');
        expect(getConfigPermission('user', config, 'change:run')).toBe('confirm');
        expect(getConfigPermission('agent', config, 'sql:write')).toBe('deny');

    });

    it('does not share overrides across projects with the same config name', () => {

        const strict = target('admin', { roles: { admin: { permissions: { 'sql:read': 'deny' } } } });
        const stock = target('admin');
        expect(getConfigPermission('user', strict, 'sql:read')).toBe('deny');
        expect(getConfigPermission('user', stock, 'sql:read')).toBe('allow');
        expect(getPolicyFingerprint(strict)).not.toBe(getPolicyFingerprint(stock));

    });

    it('binds grants to both project and resolved connection', async () => {

        const first = target('operator', { targetIdentity: policyTargetIdentity('/project-a', { database: 'one' }) });
        const otherProject = target('operator', { targetIdentity: policyTargetIdentity('/project-b', { database: 'one' }) });
        const otherDatabase = target('operator', { targetIdentity: policyTargetIdentity('/project-a', { database: 'two' }) });
        await withPolicyConfirmation(first, ['change:run'], async () => {

            expect(checkConfigPolicy('agent', first, 'change:run').allowed).toBe(true);
            expect(checkConfigPolicy('agent', otherProject, 'change:run').allowed).toBe(false);
            expect(checkConfigPolicy('agent', otherDatabase, 'change:run').allowed).toBe(false);

        });

    });

    it('limits internal grants to the exact effective config and permissions, never deny', async () => {

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

});
