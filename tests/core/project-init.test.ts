import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import { performProjectInit, scaffoldDbLayout } from '../../src/core/project-init.js';
import { DEFAULT_PATH_CONFIG } from '../../src/core/settings/defaults.js';
import { SettingsManager } from '../../src/core/settings/manager.js';
import { resolveChangesDir, resolveSqlDir } from '../../src/tui/utils/paths.js';

const hasGlobalIdentity = existsSync(join(homedir(), '.noorm', 'identity.key'));

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
        expect(existsSync(join(tmpDir, 'db', 'sql', '.gitkeep'))).toBe(true);
        expect(existsSync(join(tmpDir, 'db', 'changes', '.gitkeep'))).toBe(true);
        expect(existsSync(join(tmpDir, 'sql'))).toBe(false);
        expect(existsSync(join(tmpDir, 'changes'))).toBe(false);
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

    // Init makes the directories and writes `paths` separately. If they disagree,
    // `build` reads a folder init never made and succeeds on zero files.
    it.skipIf(!hasGlobalIdentity)('should write settings paths that resolve to the directories it created', async () => {

        await performProjectInit({
            projectRoot: tmpDir,
            force: false,
            identityInfo: null,
        });

        const manager = new SettingsManager(tmpDir);
        const settings = await manager.load();

        expect(settings.paths?.sql).toBe('./db/sql');
        expect(settings.paths?.changes).toBe('./db/changes');
        expect(resolveSqlDir(tmpDir, settings)).toBe(join(tmpDir, 'db', 'sql'));
        expect(resolveChangesDir(tmpDir, settings)).toBe(join(tmpDir, 'db', 'changes'));
        expect(existsSync(resolveSqlDir(tmpDir, settings))).toBe(true);
        expect(existsSync(resolveChangesDir(tmpDir, settings))).toBe(true);

    });

    it.skipIf(!hasGlobalIdentity)('should not overwrite agent steering files on re-init', async () => {

        await performProjectInit({
            projectRoot: tmpDir,
            force: false,
            identityInfo: null,
        });

        const agentsPath = join(tmpDir, 'db', 'AGENTS.md');
        const claudePath = join(tmpDir, 'db', 'CLAUDE.md');

        writeFileSync(agentsPath, 'Always use PascalCase.\n');
        writeFileSync(claudePath, '@AGENTS.md\n\nUse plan mode.\n');

        const second = await performProjectInit({
            projectRoot: tmpDir,
            force: true,
            identityInfo: null,
        });

        expect(readFileSync(agentsPath, 'utf-8')).toBe('Always use PascalCase.\n');
        expect(readFileSync(claudePath, 'utf-8')).toBe('@AGENTS.md\n\nUse plan mode.\n');
        expect(second.createdFiles).not.toContain('db/AGENTS.md');
        expect(second.createdFiles).not.toContain('db/CLAUDE.md');

    });

    it.skipIf(!hasGlobalIdentity)('should keep a legacy project layout on --force', async () => {

        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n    changes: ./changes\n');
        mkdirSync(join(tmpDir, 'sql'), { recursive: true });
        mkdirSync(join(tmpDir, 'changes'), { recursive: true });

        const result = await performProjectInit({
            projectRoot: tmpDir,
            force: true,
            identityInfo: null,
        });

        const settings = await new SettingsManager(tmpDir).load();

        expect(settings.paths).toEqual({ sql: './sql', changes: './changes' });
        expect(existsSync(join(tmpDir, 'db'))).toBe(false);
        expect(result.createdFiles.some((f) => f.startsWith('db/'))).toBe(false);

    });

});

describe('core: scaffoldDbLayout', () => {

    let tmpDir: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-scaffold-'));

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('should nest sql/ and changes/ under db/', () => {

        const created = scaffoldDbLayout(tmpDir, DEFAULT_PATH_CONFIG);

        expect(created).toEqual([
            'db/sql/.gitkeep',
            'db/changes/.gitkeep',
            'db/AGENTS.md',
            'db/CLAUDE.md',
        ]);
        expect(existsSync(join(tmpDir, 'db', 'sql'))).toBe(true);
        expect(existsSync(join(tmpDir, 'db', 'changes'))).toBe(true);

    });

    it('should template AGENTS.md for the user and import it from CLAUDE.md', () => {

        scaffoldDbLayout(tmpDir, DEFAULT_PATH_CONFIG);

        const agents = readFileSync(join(tmpDir, 'db', 'AGENTS.md'), 'utf-8');
        const claude = readFileSync(join(tmpDir, 'db', 'CLAUDE.md'), 'utf-8');

        expect(agents).toContain('Use the `/noorm` skill for managing files here.');
        expect(agents).toContain('<!-- add user specific LLM steering here -->');
        expect(claude.split('\n')).toContain('@AGENTS.md');

    });

    it('should create nothing for a project on its own layout', () => {

        const created = scaffoldDbLayout(tmpDir, { sql: './sql', changes: './changes' });

        expect(created).toEqual([]);
        expect(existsSync(join(tmpDir, 'db'))).toBe(false);

    });

    it('should leave an existing CLAUDE.md untouched and report only what it created', () => {

        mkdirSync(join(tmpDir, 'db'), { recursive: true });
        writeFileSync(join(tmpDir, 'db', 'CLAUDE.md'), 'mine\n');

        const created = scaffoldDbLayout(tmpDir, DEFAULT_PATH_CONFIG);

        expect(readFileSync(join(tmpDir, 'db', 'CLAUDE.md'), 'utf-8')).toBe('mine\n');
        expect(created).toContain('db/AGENTS.md');
        expect(created).not.toContain('db/CLAUDE.md');

    });

});
