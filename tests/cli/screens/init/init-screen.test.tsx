/**
 * InitScreen component tests.
 *
 * Which step the screen settles on, given what is on disk. Each case runs the
 * real screen in a child process with a throwaway HOME and project directory,
 * so nothing in this process is mocked.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { createThrowawayHome, type ThrowawayHome } from '../../fixtures/throwaway-home.js';

const INIT = join(import.meta.dir, '..', '..', 'fixtures', 'init-screen-home.tsx');

describe('cli: screens/init/InitScreen', () => {

    let home: ThrowawayHome;

    beforeEach(async () => {

        home = await createThrowawayHome();

    });

    afterEach(async () => {

        await home.remove();

    });

    const show = (...args: string[]): { first: string; settled: string } => JSON.parse(home.run(INIT, 'show', ...args));

    it('should show checking state initially', () => {

        expect(show().first).toContain('Checking');

    });

    it('should transition to identity setup when no identity exists', () => {

        expect(show().settled).toContain('Welcome to noorm');

    });

    it('should show already initialized warning when .noorm exists', async () => {

        await mkdir(join(home.projectRoot, '.noorm'));

        expect(show().settled).toContain('Already Initialized');

    });

    it('should skip identity setup when identity exists', async () => {

        await home.writeIdentity();

        expect(show().settled).toContain('Initialize noorm');

    });

    it('should bypass warning with force param', async () => {

        await mkdir(join(home.projectRoot, '.noorm'));
        await home.writeIdentity();

        const { settled } = show('force');

        expect(settled).toContain('Initialize noorm');
        expect(settled).not.toContain('Already Initialized');

    });

});
