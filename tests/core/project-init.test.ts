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

    /**
     * The block exists to keep `.noorm/state/` — state.enc and the log file —
     * out of version control. Asserting only that the `# noorm` header landed
     * would pass against a header with no entries under it, which is what
     * init actually wrote.
     */
    it('should append a # noorm block that ignores the state directory', async () => {

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
        expect(content).toContain('.noorm/state/');
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

    it('should write an ignore entry when creating .gitignore from scratch', async () => {

        const globalIdentity = join(homedir(), '.noorm', 'identity.key');
        if (!existsSync(globalIdentity)) return;

        await performProjectInit({
            projectRoot: tmpDir,
            force: false,
            identityInfo: null,
        });

        const content = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');

        expect(content).toContain('.noorm/state/');

    });

    /**
     * Earlier versions wrote a bare `# noorm` header. Keying the skip on the
     * header means those projects never get the entry; keying it on the entry
     * repairs them on the next init.
     */
    it('should repair a legacy # noorm block that has no entries under it', async () => {

        const globalIdentity = join(homedir(), '.noorm', 'identity.key');
        if (!existsSync(globalIdentity)) return;

        const gitignorePath = join(tmpDir, '.gitignore');
        const { writeFileSync } = await import('node:fs');
        writeFileSync(gitignorePath, 'node_modules\n\n# noorm\n');

        await performProjectInit({
            projectRoot: tmpDir,
            force: false,
            identityInfo: null,
        });

        expect(readFileSync(gitignorePath, 'utf-8')).toContain('.noorm/state/');

    });

});
