/**
 * cli: `run preview` / `run inspect` honour the config's access policy.
 *
 * The matrix denies `viewer` every `run:*` permission, and `run build`,
 * `run file` and `run dir` all enforce it. `preview` and `inspect` never
 * loaded a policy at all — so the least-privileged role could dump every
 * resolved secret as plaintext (`preview` prints the rendered SQL) and
 * execute the template's helper and side-car scripts (both commands build
 * the context). The end-to-end shape is what matters here: the audit
 * reached this through the shipped binary, not through the core function.
 *
 * Also pins the half that must keep working — a viewer's own SQL previews
 * fine once the project has no config to scope the denial to, and an
 * `operator` (a `confirm` cell, not a denial) is not blocked from a
 * read-only render.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { StateManager } from '../../../src/core/state/manager.js';
import { generateKeyPair } from '../../../src/core/identity/index.js';
import type { Config } from '../../../src/core/config/types.js';
import type { Role } from '../../../src/core/policy/index.js';

import { TMP_BASE, cleanupProject, runCli, type TestProject } from './_setup.js';

/**
 * A project whose stored, active config carries the given user role.
 *
 * Written through StateManager rather than the CLI because there is no
 * headless `config add` — the same reason the vault-probe suite does it.
 */
async function setupRoleProject(role: Role): Promise<TestProject> {

    const testId = randomUUID().slice(0, 8);
    const dir = join(TMP_BASE, `cli-run-policy-${testId}`);
    const sqlDir = join(dir, 'sql');

    await mkdir(sqlDir, { recursive: true });
    await writeFile(join(sqlDir, 'greet.sql.tmpl'), "select 'hi' as val;\n");

    const { privateKey } = generateKeyPair();

    const config: Config = {
        name: 'guarded',
        type: 'local',
        isTest: true,
        access: { user: role, agent: role },
        connection: {
            dialect: 'sqlite',
            database: join(dir, '.noorm', 'test.db'),
        },
    };

    const state = new StateManager(dir, { privateKey });
    await state.load();
    await state.setConfig(config.name, config);
    await state.setActiveConfig(config.name);

    return {
        dir,
        dbPath: '',
        env: {
            NOORM_IDENTITY_PRIVATE_KEY: privateKey,
            NOORM_IDENTITY_NAME: 'Policy Tester',
            NOORM_IDENTITY_EMAIL: 'policy@example.com',
        },
    };

}

describe('cli: run preview / run inspect access gate', () => {

    let project: TestProject | undefined;

    afterEach(async () => {

        if (project) await cleanupProject(project);
        project = undefined;

    });

    it('should refuse run preview on a viewer config', async () => {

        project = await setupRoleProject('viewer');

        const result = runCli(project, ['run', 'preview', 'sql/greet.sql.tmpl']);

        expect(result.status).not.toBe(0);

        // The rendered SQL is the payload the gate exists to withhold.
        expect(result.stdout).not.toContain("select 'hi' as val;");
        expect(result.stdout + result.stderr).toMatch(/run:file/);

    });

    it('should refuse run inspect on a viewer config', async () => {

        project = await setupRoleProject('viewer');

        const result = runCli(project, ['run', 'inspect', 'sql/greet.sql.tmpl']);

        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toMatch(/run:file/);

    });

    it('should still allow run preview on an operator config', async () => {

        project = await setupRoleProject('operator');

        const result = runCli(project, ['run', 'preview', 'sql/greet.sql.tmpl']);

        // `run:file` is a `confirm` cell for operator, not a denial — a
        // read-only render must not inherit an execution's confirmation.
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("select 'hi' as val;");

    });

});
