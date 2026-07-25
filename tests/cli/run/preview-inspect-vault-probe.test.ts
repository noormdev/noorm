/**
 * cli: `run preview` / `run inspect` stay fast with no reachable database
 * and say so rather than silently showing only local secrets (v1/49-54
 * finding 1). CP6 wired both commands to probe the vault tier through a
 * brand-new connection; without a fail-fast override that probe inherited
 * `createConnection`'s 3x/1s-backoff retry policy (~6-7s) on a
 * documented-offline command, and degraded silently on failure.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { StateManager } from '../../../src/core/state/manager.js';
import { generateKeyPair } from '../../../src/core/identity/index.js';
import type { Config } from '../../../src/core/config/types.js';

import { TMP_BASE, cleanupProject, extractJsonObject, runCli, type TestProject } from './_setup.js';

/**
 * A project with a stored, active config pointing at a database that will
 * never accept a connection. Nothing listens on the chosen port — a fast,
 * certain ECONNREFUSED, not a slow network timeout — so any elapsed-time
 * assertion is measuring retry/backoff, not the OS's own connect timeout.
 */
async function setupUnreachableProject(): Promise<TestProject> {

    const testId = randomUUID().slice(0, 8);
    const dir = join(TMP_BASE, `cli-run-vault-probe-${testId}`);
    const sqlDir = join(dir, 'sql');

    await mkdir(sqlDir, { recursive: true });
    await writeFile(join(sqlDir, 'greet.sql.tmpl'), "select 'hi' as val;\n");

    const { privateKey } = generateKeyPair();

    const config: Config = {
        name: 'unreachable',
        type: 'local',
        isTest: true,
        access: { user: 'admin', mcp: 'admin' },
        connection: {
            dialect: 'postgres',
            host: '127.0.0.1',
            port: 59999,
            database: 'nope',
        },
    };

    // Written directly through StateManager (not via the CLI, which has no
    // headless `config add`) so the subprocess spawned below finds a
    // stored, active config without any interactive setup.
    const state = new StateManager(dir, { privateKey });
    await state.load();
    await state.setConfig(config.name, config);
    await state.setActiveConfig(config.name);

    return {
        dir,
        dbPath: '',
        env: {
            // Matches the key state.enc was encrypted with, so the CLI
            // subprocess can decrypt it without touching ~/.noorm.
            NOORM_IDENTITY_PRIVATE_KEY: privateKey,
            NOORM_IDENTITY_NAME: 'Probe Tester',
            NOORM_IDENTITY_EMAIL: 'probe@example.com',
        },
    };

}

describe('cli: run preview / run inspect stay fast offline (v1/49-54 finding 1)', () => {

    let project: TestProject | undefined;

    afterEach(async () => {

        if (project) await cleanupProject(project);
        project = undefined;

    });

    it('run preview returns quickly and notes the vault tier was not consulted (text)', async () => {

        project = await setupUnreachableProject();

        const start = Date.now();
        const result = runCli(project, ['run', 'preview', 'sql/greet.sql.tmpl']);
        const elapsed = Date.now() - start;

        // Comfortably under the ~6-7s the default retry/backoff would add,
        // comfortably above a bare CLI invocation so this isn't flaky
        // under a loaded CI runner.
        expect(elapsed).toBeLessThan(4000);
        expect(result.status).toBe(0);

        // The rendered SQL still reaches stdout, undisturbed and pipeable.
        expect(result.stdout).toContain("select 'hi' as val;");

        // The notice is a diagnostic, not part of the pipeable result.
        expect(result.stderr).toMatch(/vault/i);
        expect(result.stderr).not.toContain('undefined');

    });

    it('run preview reports the same notice in --json mode', async () => {

        project = await setupUnreachableProject();

        const result = runCli(project, ['run', 'preview', 'sql/greet.sql.tmpl', '--json']);

        expect(result.status).toBe(0);

        const jsonText = extractJsonObject(result.stdout);
        expect(jsonText).not.toBeNull();

        const parsed = JSON.parse(jsonText!) as { vaultProbeFailed?: boolean; notice?: string };
        expect(parsed.vaultProbeFailed).toBe(true);
        expect(parsed.notice).toMatch(/vault/i);

    });

    it('run inspect returns quickly and notes the vault tier was not consulted (text)', async () => {

        project = await setupUnreachableProject();

        const start = Date.now();
        const result = runCli(project, ['run', 'inspect', 'sql/greet.sql.tmpl']);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(4000);
        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/vault/i);

    });

    it('run inspect reports the same notice in --json mode', async () => {

        project = await setupUnreachableProject();

        const result = runCli(project, ['run', 'inspect', 'sql/greet.sql.tmpl', '--json']);

        expect(result.status).toBe(0);

        const jsonText = extractJsonObject(result.stdout);
        expect(jsonText).not.toBeNull();

        const parsed = JSON.parse(jsonText!) as { vaultProbeFailed?: boolean; notice?: string };
        expect(parsed.vaultProbeFailed).toBe(true);
        expect(parsed.notice).toMatch(/vault/i);

    });

});
