/**
 * Fast (no live DB) tests for CP6's vault-tier wiring at the render-context
 * builders (`TemplatesNamespace.render`, mirrored by `RunNamespace` /
 * `ChangesNamespace`). A disconnected project — no vault to reach at all —
 * must keep rendering exactly as it did before `buildSecretsContext`
 * replaced `getAllSecrets`; the live-vault precedence itself is proven
 * against a real database in `tests/integration/sdk/run-vault-secrets.test.ts`.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TemplatesNamespace } from '../../src/sdk/namespaces/templates.js';
import { getStateManager, resetStateManager } from '../../src/core/state/index.js';

import type { ContextState } from '../../src/sdk/state.js';
import type { Config } from '../../src/core/config/types.js';
import type { Identity } from '../../src/core/identity/types.js';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<Config> = {}): Config {

    return {
        name: 'dev',
        type: 'local',
        isTest: false,
        access: { user: 'admin', mcp: 'admin' },
        connection: { dialect: 'postgres', database: 'testdb' },
        ...overrides,
    };

}

const mockIdentity: Identity = {
    name: 'tester',
    source: 'system',
};

function makeState(projectRoot: string, config: Config): ContextState {

    return {
        connection: null,
        config,
        settings: {},
        identity: mockIdentity,
        options: {},
        projectRoot,
        changeManager: null,
    };

}

async function makeProject(templateBody: string): Promise<string> {

    const projectRoot = await mkdtemp(join(tmpdir(), 'noorm-vault-degrade-'));

    await mkdir(join(projectRoot, 'sql'), { recursive: true });
    await writeFile(join(projectRoot, 'sql', 'greet.sql.tmpl'), templateBody);

    return projectRoot;

}

const tempDirs: string[] = [];

afterEach(async () => {

    resetStateManager();

    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));

});

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('sdk: render context resolves secrets without a connection (CP6 degrade path)', () => {

    it('renders using the local tier, no throw, when there is no database connection at all', async () => {

        const projectRoot = await makeProject("select '{%~ $.secrets.GREETING %}' as val;");
        tempDirs.push(projectRoot);

        resetStateManager();
        const state = getStateManager(projectRoot);
        await state.load();

        const config = makeConfig();
        await state.setConfig(config.name, config);
        await state.setSecret(config.name, 'GREETING', 'hello-local');

        const templates = new TemplatesNamespace(makeState(projectRoot, config));

        const result = await templates.render('sql/greet.sql.tmpl');

        expect(result.sql).toContain('hello-local');

    });

    it('applies config-local over global-local precedence with no vault reachable', async () => {

        const projectRoot = await makeProject("select '{%~ $.secrets.SHARED_KEY %}' as val;");
        tempDirs.push(projectRoot);

        resetStateManager();
        const state = getStateManager(projectRoot);
        await state.load();

        const config = makeConfig();
        await state.setConfig(config.name, config);
        await state.setGlobalSecret('SHARED_KEY', 'global-value');
        await state.setSecret(config.name, 'SHARED_KEY', 'config-value');

        const templates = new TemplatesNamespace(makeState(projectRoot, config));

        const result = await templates.render('sql/greet.sql.tmpl');

        expect(result.sql).toContain('config-value');
        expect(result.sql).not.toContain('global-value');

    });

});
