import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import { performProjectInit } from '../../src/core/project-init.js';

describe('core: performProjectInit', () => {

    let tmpDir: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-init-core-'));

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('should create project structure without touching identity when identity info is not provided', async () => {

        const globalIdentity = join(homedir(), '.noorm', 'identity.key');
        if (!existsSync(globalIdentity)) return;

        const result = await performProjectInit({
            projectRoot: tmpDir,
            force: false,
            identityInfo: null,
        });

        expect(result.success).toBe(true);
        expect(existsSync(join(tmpDir, 'sql', '.gitkeep'))).toBe(true);
        expect(existsSync(join(tmpDir, 'changes', '.gitkeep'))).toBe(true);
        expect(existsSync(join(tmpDir, '.noorm', 'settings.yml'))).toBe(true);
        expect(existsSync(join(tmpDir, '.noorm', '.gitignore'))).toBe(true);
        expect(existsSync(join(tmpDir, '.noorm', 'state'))).toBe(true);

    });

    it('should append # noorm block to existing .gitignore only if missing', async () => {

        const globalIdentity = join(homedir(), '.noorm', 'identity.key');
        if (!existsSync(globalIdentity)) return;

        const gitignorePath = join(tmpDir, '.gitignore');
        const { writeFileSync } = await import('node:fs');
        writeFileSync(gitignorePath, 'node_modules\n');

        await performProjectInit({
            projectRoot: tmpDir,
            force: false,
            identityInfo: null,
        });

        const content = readFileSync(gitignorePath, 'utf-8');
        expect(content).toContain('# noorm');
        expect(content).toContain('node_modules');

        await performProjectInit({
            projectRoot: tmpDir,
            force: true,
            identityInfo: null,
        });

        const content2 = readFileSync(gitignorePath, 'utf-8');
        const occurrences = content2.split('# noorm').length - 1;
        expect(occurrences).toBe(1);

    });

});
