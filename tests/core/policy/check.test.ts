/**
 * Access policy: checkPolicy + guarded.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { assertPolicy, checkConfigPolicy, checkPolicy, confirmationPhraseFor, formatAccessTag, guarded } from '../../../src/core/policy/index.js';
import type { Channel, Permission, PolicyCell, PolicyTarget, Role } from '../../../src/core/policy/index.js';

/**
 * The matrix from `docs/spec/config-access-roles.md`, authored independently
 * of `src/core/policy/matrix.ts` so these tests catch a wrong cell, not just
 * a self-consistent one.
 */
const EXPECTED_MATRIX: Record<Permission, Record<Role, PolicyCell>> = {
    'explore': { viewer: 'allow', operator: 'allow', admin: 'allow' },

    'sql:read': { viewer: 'allow', operator: 'allow', admin: 'allow' },
    'sql:write': { viewer: 'deny', operator: 'allow', admin: 'allow' },
    'sql:ddl': { viewer: 'deny', operator: 'deny', admin: 'allow' },

    'change:run': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'change:ff': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'change:revert': { viewer: 'deny', operator: 'confirm', admin: 'allow' },

    'run:build': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'run:file': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'run:dir': { viewer: 'deny', operator: 'confirm', admin: 'allow' },

    'db:create': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'db:reset': { viewer: 'deny', operator: 'confirm', admin: 'allow' },
    'db:destroy': { viewer: 'deny', operator: 'deny', admin: 'confirm' },

    'config:rm': { viewer: 'deny', operator: 'confirm', admin: 'confirm' },
};

const PERMISSIONS: Permission[] = [
    'explore',
    'sql:read', 'sql:write', 'sql:ddl',
    'change:run', 'change:ff', 'change:revert',
    'run:build', 'run:file', 'run:dir',
    'db:create', 'db:reset', 'db:destroy',
    'config:rm',
];
const ROLES: Role[] = ['viewer', 'operator', 'admin'];
const CHANNELS: Channel[] = ['user', 'mcp'];

/**
 * Build a target where both channels carry the given role, so the channel
 * under test is what actually drives `checkPolicy`'s decision.
 */
function targetFor(role: Role, name = 'acme'): PolicyTarget {

    return { name, access: { user: role, mcp: role } };

}

describe('policy: checkPolicy', () => {

    const envBackup: Record<string, string | undefined> = {};

    beforeEach(() => {

        envBackup['NOORM_YES'] = process.env['NOORM_YES'];
        delete process.env['NOORM_YES'];

    });

    afterEach(() => {

        if (envBackup['NOORM_YES'] === undefined) {

            delete process.env['NOORM_YES'];

        }
        else {

            process.env['NOORM_YES'] = envBackup['NOORM_YES'];

        }

    });

    for (const permission of PERMISSIONS) {

        for (const role of ROLES) {

            for (const channel of CHANNELS) {

                const cell = EXPECTED_MATRIX[permission][role];

                it(`${permission} / ${role} / ${channel} -> ${cell}`, () => {

                    const target = targetFor(role);
                    const check = checkPolicy(channel, target, permission);

                    if (cell === 'allow') {

                        expect(check.allowed).toBe(true);
                        expect(check.requiresConfirmation).toBe(false);

                        return;

                    }

                    if (cell === 'deny') {

                        expect(check.allowed).toBe(false);
                        expect(check.requiresConfirmation).toBe(false);
                        expect(check.blockedReason).toBeDefined();

                        return;

                    }

                    // cell === 'confirm', channel-resolved
                    if (channel === 'user') {

                        expect(check.allowed).toBe(true);
                        expect(check.requiresConfirmation).toBe(true);
                        expect(check.confirmationPhrase).toBe(`yes-${target.name}`);

                    }
                    else {

                        expect(check.allowed).toBe(false);
                        expect(check.requiresConfirmation).toBe(false);
                        expect(check.blockedReason).toBeDefined();
                        expect(check.blockedReason?.toLowerCase()).toContain('cli');

                    }

                });

            }

        }

    }

    it('should skip user-channel confirmation when NOORM_YES=1', () => {

        process.env['NOORM_YES'] = '1';

        const check = checkPolicy('user', targetFor('operator', 'prod'), 'change:run');

        expect(check.allowed).toBe(true);
        expect(check.requiresConfirmation).toBe(false);
        expect(check.confirmationPhrase).toBeUndefined();

    });

    it('should not let NOORM_YES affect the mcp channel', () => {

        process.env['NOORM_YES'] = '1';

        const check = checkPolicy('mcp', targetFor('operator', 'prod'), 'change:run');

        expect(check.allowed).toBe(false);
        expect(check.blockedReason).toBeDefined();

    });

    it('should skip user-channel confirmation when NOORM_YES=yes (unified truthiness, not just 1/true)', () => {

        process.env['NOORM_YES'] = 'yes';

        const check = checkPolicy('user', targetFor('operator', 'prod'), 'change:run');

        expect(check.allowed).toBe(true);
        expect(check.requiresConfirmation).toBe(false);
        expect(check.confirmationPhrase).toBeUndefined();

    });

    it('should still require confirmation when NOORM_YES=0 (unified truthiness stays falsy for 0)', () => {

        process.env['NOORM_YES'] = '0';

        const check = checkPolicy('user', targetFor('operator', 'prod'), 'change:run');

        expect(check.allowed).toBe(true);
        expect(check.requiresConfirmation).toBe(true);
        expect(check.confirmationPhrase).toBe('yes-prod');

    });

    it('should deny with a blockedReason when access.mcp is false', () => {

        const target: PolicyTarget = { name: 'invisible', access: { user: 'admin', mcp: false } };

        const check = checkPolicy('mcp', target, 'explore');

        expect(check.allowed).toBe(false);
        expect(check.requiresConfirmation).toBe(false);
        expect(check.blockedReason).toBeDefined();

    });

});

describe('policy: checkConfigPolicy', () => {

    it('should deny on the user channel with the shared message when access is absent', () => {

        const check = checkConfigPolicy('user', { name: 'legacy' }, 'explore');

        expect(check.allowed).toBe(false);
        expect(check.requiresConfirmation).toBe(false);
        expect(check.blockedReason).toBe('Config "legacy" has no access configuration.');

    });

    it('should deny on the mcp channel with the same shared message when access is absent', () => {

        const check = checkConfigPolicy('mcp', { name: 'legacy' }, 'explore');

        expect(check.allowed).toBe(false);
        expect(check.requiresConfirmation).toBe(false);
        expect(check.blockedReason).toBe('Config "legacy" has no access configuration.');

    });

    it('should delegate to checkPolicy when access is present', () => {

        const check = checkConfigPolicy('user', targetFor('admin'), 'db:destroy');

        expect(check.allowed).toBe(true);
        expect(check.requiresConfirmation).toBe(true);
        expect(check.confirmationPhrase).toBe('yes-acme');

    });

});

describe('policy: assertPolicy', () => {

    it('should throw with the blockedReason when a viewer is denied', () => {

        expect(() => assertPolicy('user', targetFor('viewer'), 'db:destroy')).toThrow(
            '"db:destroy" is not allowed on config "acme" (role: viewer).',
        );

    });

    it('should not throw when an admin is allowed', () => {

        expect(() => assertPolicy('user', targetFor('admin'), 'sql:read')).not.toThrow();

    });

    it('should deny with the shared fallback message when access is absent', () => {

        expect(() => assertPolicy('user', { name: 'legacy' }, 'explore')).toThrow(
            'Config "legacy" has no access configuration.',
        );

    });

});

describe('policy: confirmationPhraseFor', () => {

    it('should produce the yes-<name> phrase checkPolicy resolves for a confirm cell', () => {

        expect(confirmationPhraseFor('prod')).toBe('yes-prod');

        const check = checkPolicy('user', targetFor('operator', 'prod'), 'change:run');

        expect(check.confirmationPhrase).toBe(confirmationPhraseFor('prod'));

    });

});

describe('policy: guarded', () => {

    it('should be false for admin', () => {

        expect(guarded(targetFor('admin'))).toBe(false);

    });

    it('should be true for operator', () => {

        expect(guarded(targetFor('operator'))).toBe(true);

    });

    it('should be true for viewer', () => {

        expect(guarded(targetFor('viewer'))).toBe(true);

    });

});

describe('policy: formatAccessTag', () => {

    it('should render "user:<role> mcp:<role>" for a guarded config', () => {

        const config: PolicyTarget = { name: 'prod', access: { user: 'operator', mcp: 'viewer' } };

        expect(formatAccessTag(config)).toBe('user:operator mcp:viewer');

    });

    it('should render "mcp:off" when access.mcp is false', () => {

        const config: PolicyTarget = { name: 'prod', access: { user: 'viewer', mcp: false } };

        expect(formatAccessTag(config)).toBe('user:viewer mcp:off');

    });

    it('should return null for an admin/admin (fully open) config', () => {

        const config: PolicyTarget = { name: 'prod', access: { user: 'admin', mcp: 'admin' } };

        expect(formatAccessTag(config)).toBeNull();

    });

});
