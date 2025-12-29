/**
 * Protected config handling tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    checkProtection,
    validateConfirmation,
    type ProtectedAction,
} from '../../../src/core/config/index.js';
import type { Config } from '../../../src/core/config/index.js';

/**
 * Create a test config.
 */
function createConfig(overrides: Partial<Config> = {}): Config {

    return {
        name: 'test',
        type: 'local',
        isTest: false,
        protected: false,
        connection: {
            dialect: 'sqlite',
            database: ':memory:',
        },
        paths: {
            schema: './schema',
            changesets: './changesets',
        },
        ...overrides,
    };

}

describe('config: protection', () => {

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

    describe('checkProtection', () => {

        it('should allow all actions on non-protected config', () => {

            const config = createConfig({ protected: false });
            const actions: ProtectedAction[] = [
                'change:run',
                'change:revert',
                'change:ff',
                'change:next',
                'run:build',
                'run:file',
                'run:dir',
                'db:create',
                'db:destroy',
                'config:rm',
            ];

            for (const action of actions) {

                const check = checkProtection(config, action);

                expect(check.allowed).toBe(true);
                expect(check.requiresConfirmation).toBe(false);

            }

        });

        it('should block db:destroy on protected config', () => {

            const config = createConfig({ name: 'production', protected: true });

            const check = checkProtection(config, 'db:destroy');

            expect(check.allowed).toBe(false);
            expect(check.requiresConfirmation).toBe(false);
            expect(check.blockedReason).toContain('db:destroy');
            expect(check.blockedReason).toContain('production');
            expect(check.blockedReason).toContain('not allowed');

        });

        it('should require confirmation for change actions on protected config', () => {

            const config = createConfig({ name: 'staging', protected: true });
            const actions: ProtectedAction[] = [
                'change:run',
                'change:revert',
                'change:ff',
                'change:next',
            ];

            for (const action of actions) {

                const check = checkProtection(config, action);

                expect(check.allowed).toBe(true);
                expect(check.requiresConfirmation).toBe(true);
                expect(check.confirmationPhrase).toBe('yes-staging');

            }

        });

        it('should require confirmation for run actions on protected config', () => {

            const config = createConfig({ name: 'prod', protected: true });
            const actions: ProtectedAction[] = ['run:build', 'run:file', 'run:dir'];

            for (const action of actions) {

                const check = checkProtection(config, action);

                expect(check.allowed).toBe(true);
                expect(check.requiresConfirmation).toBe(true);
                expect(check.confirmationPhrase).toBe('yes-prod');

            }

        });

        it('should require confirmation for db:create on protected config', () => {

            const config = createConfig({ name: 'main', protected: true });

            const check = checkProtection(config, 'db:create');

            expect(check.allowed).toBe(true);
            expect(check.requiresConfirmation).toBe(true);
            expect(check.confirmationPhrase).toBe('yes-main');

        });

        it('should require confirmation for config:rm on protected config', () => {

            const config = createConfig({ name: 'primary', protected: true });

            const check = checkProtection(config, 'config:rm');

            expect(check.allowed).toBe(true);
            expect(check.requiresConfirmation).toBe(true);
            expect(check.confirmationPhrase).toBe('yes-primary');

        });

        it('should skip confirmation when NOORM_YES is set', () => {

            process.env['NOORM_YES'] = '1';
            const config = createConfig({ name: 'prod', protected: true });

            const check = checkProtection(config, 'change:run');

            expect(check.allowed).toBe(true);
            expect(check.requiresConfirmation).toBe(false);

        });

        it('should still block db:destroy even with NOORM_YES', () => {

            process.env['NOORM_YES'] = '1';
            const config = createConfig({ name: 'prod', protected: true });

            const check = checkProtection(config, 'db:destroy');

            expect(check.allowed).toBe(false);

        });

        it('should handle unknown actions as allowed', () => {

            const config = createConfig({ protected: true });

            // Cast to bypass type check for unknown action
            const check = checkProtection(config, 'unknown:action' as ProtectedAction);

            expect(check.allowed).toBe(true);
            expect(check.requiresConfirmation).toBe(false);

        });

    });

    describe('validateConfirmation', () => {

        it('should accept correct confirmation phrase', () => {

            const config = createConfig({ name: 'production' });

            expect(validateConfirmation(config, 'yes-production')).toBe(true);

        });

        it('should reject incorrect confirmation phrase', () => {

            const config = createConfig({ name: 'production' });

            expect(validateConfirmation(config, 'yes')).toBe(false);
            expect(validateConfirmation(config, 'yes-staging')).toBe(false);
            expect(validateConfirmation(config, 'production')).toBe(false);
            expect(validateConfirmation(config, '')).toBe(false);

        });

        it('should be case-sensitive', () => {

            const config = createConfig({ name: 'Production' });

            expect(validateConfirmation(config, 'yes-Production')).toBe(true);
            expect(validateConfirmation(config, 'yes-production')).toBe(false);

        });

    });

});
