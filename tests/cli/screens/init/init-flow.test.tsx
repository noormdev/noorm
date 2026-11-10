/**
 * Init flow integration tests.
 *
 * The complete initialization flow, from identity setup through project
 * creation. Each case runs the real screen in a child process with a throwaway
 * HOME and project directory, and reads what it left on disk.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { attempt } from '@logosdx/utils';

import { createThrowawayHome, type ThrowawayHome } from '../../fixtures/throwaway-home.js';

const INIT = join(import.meta.dir, '..', '..', 'fixtures', 'init-screen-home.tsx');

describe('cli: screens/init - flow integration', () => {

    let home: ThrowawayHome;

    beforeEach(async () => {

        home = await createThrowawayHome();

    });

    afterEach(async () => {

        await home.remove();

    });

    const flow = (mode: string): { settled: string; project: string; final: string } => JSON.parse(home.run(INIT, mode));

    async function exists(path: string): Promise<boolean> {

        const [, err] = await attempt(() => access(path));

        return !err;

    }

    /** The paths the completion panel says init created, resolved to where they would be on disk. */
    function listedAsCreated(final: string): string[] {

        return final.split('\n')
            .map((row) => row.match(/•\s+(\S+)/)?.[1])
            .filter((listed): listed is string => listed !== undefined)
            .map((listed) => listed.startsWith('~/') ? join(home.noormHome, '..', listed.slice(2)) : join(home.projectRoot, listed));

    }

    async function expectInitialized(final: string): Promise<void> {

        const { projectRoot } = home;
        const listed = listedAsCreated(final);

        expect(listed).toContain(join(projectRoot, '.noorm', 'settings.yml'));
        expect(listed).toContain(join(projectRoot, 'db', 'sql', '.gitkeep'));
        expect(listed).toContain(home.keyPath);

        for (const path of listed) expect({ path, exists: await exists(path) }).toEqual({ path, exists: true });

        expect(await exists(join(projectRoot, '.noorm', 'settings.yml'))).toBe(true);
        expect(await exists(join(projectRoot, '.noorm', 'state'))).toBe(true);
        expect(await readFile(join(projectRoot, '.noorm', '.gitignore'), 'utf8')).toBe('state/\n');
        expect(await readFile(join(projectRoot, '.gitignore'), 'utf8')).toContain('# noorm');
        expect(await exists(join(projectRoot, 'db', 'sql', '.gitkeep'))).toBe(true);
        expect(await exists(home.keyPath)).toBe(true);
        expect(await exists(home.pubPath)).toBe(true);
        expect(JSON.parse(await readFile(home.metadataPath, 'utf8')).email).toBe('git@example.com');

    }

    it('should transition from identity to project setup on form submission', async () => {

        const { settled, project } = flow('identity');

        expect(settled).toContain('Welcome to noorm');
        expect(project).toContain('Initialize noorm');
        expect(project).toContain('set up my first config');
        expect(await exists(home.keyPath)).toBe(false);

    });

    it('should complete init flow when add config is selected', async () => {

        const { settled, project, final } = flow('add');

        expect(settled).toContain('Welcome to noorm');
        expect(project).toContain('Initialize noorm');
        expect(final).toContain('Initialization Complete');
        expect(final).toContain('to add your first database config');
        await expectInitialized(final);

    });

    it('should complete init flow when skip config is selected', async () => {

        const { settled, project, final } = flow('skip');

        expect(settled).toContain('Welcome to noorm');
        expect(project).toContain('Initialize noorm');
        expect(final).toContain('Initialization Complete');
        expect(final).toContain('to go to home screen');
        await expectInitialized(final);

    });

    it('should skip identity setup when identity already exists', async () => {

        await home.writeIdentity();

        const { settled } = JSON.parse(home.run(INIT, 'show'));

        expect(settled).toContain('Initialize noorm');
        expect(settled).not.toContain('Welcome to noorm');

    });

});
