/**
 * Headless mode tests.
 *
 * Tests CI/CD mode detection and logging.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    shouldRunHeadless,
} from '../../src/cli/headless/index.js';
import type { CliFlags } from '../../src/cli/types.js';

/**
 * Create default CLI flags.
 */
function createFlags(overrides: Partial<CliFlags> = {}): CliFlags {

    return {
        headless: false,
        tui: false,
        json: false,
        yes: false,
        force: false,
        dryRun: false,
        ...overrides,
    };

}

describe('cli: headless', () => {

    describe('shouldRunHeadless', () => {

        const originalEnv = { ...process.env };
        const originalIsTTY = process.stdout.isTTY;

        beforeEach(() => {

            // Reset environment
            process.env = { ...originalEnv };
            // Clear CI variables
            delete process.env['CI'];
            delete process.env['CONTINUOUS_INTEGRATION'];
            delete process.env['GITHUB_ACTIONS'];
            delete process.env['GITLAB_CI'];
            delete process.env['CIRCLECI'];
            delete process.env['TRAVIS'];
            delete process.env['JENKINS_URL'];
            delete process.env['BUILDKITE'];
            delete process.env['NOORM_HEADLESS'];

        });

        afterEach(() => {

            process.env = originalEnv;
            Object.defineProperty(process.stdout, 'isTTY', {
                value: originalIsTTY,
                writable: true,
            });

        });

        it('should return true when headless flag is set', () => {

            const flags = createFlags({ headless: true });

            expect(shouldRunHeadless(flags)).toBe(true);

        });

        it('should return true when NOORM_HEADLESS is true', () => {

            process.env['NOORM_HEADLESS'] = 'true';
            const flags = createFlags();

            expect(shouldRunHeadless(flags)).toBe(true);

        });

        it('should return false when NOORM_HEADLESS is not true', () => {

            process.env['NOORM_HEADLESS'] = 'false';
            Object.defineProperty(process.stdout, 'isTTY', {
                value: true,
                writable: true,
            });
            const flags = createFlags();

            expect(shouldRunHeadless(flags)).toBe(false);

        });

        it('should return true when CI environment variable is set', () => {

            process.env['CI'] = 'true';
            const flags = createFlags();

            expect(shouldRunHeadless(flags)).toBe(true);

        });

        it('should detect GITHUB_ACTIONS', () => {

            process.env['GITHUB_ACTIONS'] = 'true';
            const flags = createFlags();

            expect(shouldRunHeadless(flags)).toBe(true);

        });

        it('should detect GITLAB_CI', () => {

            process.env['GITLAB_CI'] = 'true';
            const flags = createFlags();

            expect(shouldRunHeadless(flags)).toBe(true);

        });

        it('should detect CIRCLECI', () => {

            process.env['CIRCLECI'] = 'true';
            const flags = createFlags();

            expect(shouldRunHeadless(flags)).toBe(true);

        });

        it('should detect TRAVIS', () => {

            process.env['TRAVIS'] = 'true';
            const flags = createFlags();

            expect(shouldRunHeadless(flags)).toBe(true);

        });

        it('should detect JENKINS_URL', () => {

            process.env['JENKINS_URL'] = 'http://jenkins.example.com';
            const flags = createFlags();

            expect(shouldRunHeadless(flags)).toBe(true);

        });

        it('should detect BUILDKITE', () => {

            process.env['BUILDKITE'] = 'true';
            const flags = createFlags();

            expect(shouldRunHeadless(flags)).toBe(true);

        });

        it('should detect CONTINUOUS_INTEGRATION', () => {

            process.env['CONTINUOUS_INTEGRATION'] = 'true';
            const flags = createFlags();

            expect(shouldRunHeadless(flags)).toBe(true);

        });

        it('should return true when no TTY', () => {

            Object.defineProperty(process.stdout, 'isTTY', {
                value: false,
                writable: true,
            });
            const flags = createFlags();

            expect(shouldRunHeadless(flags)).toBe(true);

        });

        it('should return false in normal TTY environment', () => {

            Object.defineProperty(process.stdout, 'isTTY', {
                value: true,
                writable: true,
            });
            const flags = createFlags();

            expect(shouldRunHeadless(flags)).toBe(false);

        });

    });

});
