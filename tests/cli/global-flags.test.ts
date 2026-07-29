/**
 * cli: root-level flag placement
 *
 * A flag goes on the command that uses it — placing it before the
 * subcommand is an error, exactly like `--config`/`--force` already
 * behaved. The sole exception is `-c`/`--cwd`: it is consumed before
 * dispatch (it sets the working directory everything else resolves
 * against), so it genuinely is the CLI's own flag, and it stays hoisted.
 *
 * `--dry-run`/`--json`/`--yes` used to be hoisted to any position
 * (`extractGlobalFlags`, CP1 of v1/49-54). That asymmetry with
 * `--config`/`--force` was reversed: these tests assert the reversal
 * instead of the old both-positions contract.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { sql } from 'kysely';

import { createConnection } from '../../src/core/connection/factory.js';
import {
    CLI,
    TMP_BASE,
    cleanupProject,
    extractJsonObject,
    runCli,
    setupProject,
    type TestProject,
} from './run/_setup.js';

/** Whether a table exists in the project's SQLite database — ground truth independent of anything the CLI printed. */
async function tableExists(project: TestProject, tableName: string): Promise<boolean> {

    const conn = await createConnection({ dialect: 'sqlite', database: project.dbPath }, '__test__');

    const result = await sql<{ name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${tableName}
    `.execute(conn.db);

    await conn.destroy();

    return result.rows.length > 0;

}

describe('cli: root-level flag placement', () => {

    let project: TestProject;

    beforeAll(async () => {

        await mkdir(TMP_BASE, { recursive: true });

    });

    beforeEach(async () => {

        project = await setupProject();

    });

    afterEach(async () => {

        await cleanupProject(project);

    });

    describe('--json', () => {

        it('works after the subcommand', () => {

            const result = runCli(project, ['config', 'list', '--json']);

            expect(result.status).toBe(0);
            expect(JSON.parse(result.stdout.trim())).toEqual({ success: true, configs: [] });

        });

        it('errors before the subcommand instead of being silently dropped', () => {

            const result = runCli(project, ['--json', 'config', 'list']);

            expect(result.status).not.toBe(0);
            expect(result.stdout).not.toContain('configs');
            expect(result.stderr).toContain("'--json'");
            expect(result.stderr).toContain('after the subcommand');
            expect(result.stderr).toContain('noorm <command> ... --json');

        });

    });

    describe('--yes', () => {

        it('errors before the subcommand instead of being silently dropped', () => {

            const result = spawnSync('node', [CLI, '--yes', 'sql', 'repl'], {
                cwd: project.dir,
                input: '',
                encoding: 'utf-8',
                env: { ...process.env, ...project.env, NOORM_YES: '' },
            });

            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("'--yes'");
            expect(result.stderr).toContain('after the subcommand');
            expect(result.stderr).toContain('noorm <command> ... --yes');

        });

    });

    describe('--dry-run', () => {

        it('never touches the database when misplaced before the subcommand', async () => {

            await writeFile(
                `${project.dir}/sql/create.sql`,
                'CREATE TABLE noorm_dry_run_t1 (id INTEGER PRIMARY KEY);\n',
                'utf-8',
            );

            // The important case: if a leading `--dry-run` were silently dropped
            // (the pre-fix defect this whole checkpoint used to guard against),
            // this would run the CREATE TABLE for real while reporting an error.
            const leading = runCli(project, ['--dry-run', 'run', 'build']);

            expect(leading.status).not.toBe(0);
            expect(leading.stderr).toContain("'--dry-run'");
            expect(await tableExists(project, 'noorm_dry_run_t1')).toBe(false);

            const trailing = runCli(project, ['run', 'build', '--dry-run', '--json']);
            const trailingJson = JSON.parse(extractJsonObject(trailing.stdout)!);

            expect(trailing.status).toBe(0);
            expect(trailingJson.status).toBe('success');
            expect(await tableExists(project, 'noorm_dry_run_t1')).toBe(false);

        });

    });

    describe('an unrecognized flag before the subcommand', () => {

        it('exits non-zero and names the correct invocation instead of silently dropping it', () => {

            const result = runCli(project, ['--bogus', 'config', 'list']);

            expect(result.status).not.toBe(0);
            expect(result.stdout).not.toContain('configs');
            expect(result.stderr).toContain("'--bogus'");
            expect(result.stderr).toContain('after the subcommand');

        });

    });

    describe('-c/--cwd', () => {

        it('still works at root and its value is never mistaken for the subcommand name', () => {

            const result = spawnSync('node', [CLI, '-c', project.dir, 'config', 'list'], {
                cwd: TMP_BASE,
                encoding: 'utf-8',
                env: { ...process.env },
            });

            // If `project.dir` were mistaken for the subcommand, citty would
            // report it as an unknown command rather than run `config list`.
            expect(result.status).toBe(0);
            expect(result.stdout).not.toContain('Unknown command');

        });

        it('composes with a flag placed correctly on the subcommand', () => {

            const result = spawnSync('node', [CLI, '-c', project.dir, 'config', 'list', '--json'], {
                cwd: TMP_BASE,
                encoding: 'utf-8',
                env: { ...process.env },
            });

            expect(result.status).toBe(0);
            expect(JSON.parse((result.stdout ?? '').trim())).toEqual({ success: true, configs: [] });

        });

    });

    describe('--help / --version', () => {

        it('--help works before the subcommand', () => {

            const result = runCli(project, ['--help']);

            expect(result.status).toBe(0);
            expect(result.stdout).toContain('noorm');

        });

        it('--help works after the subcommand', () => {

            const result = runCli(project, ['config', '--help']);

            expect(result.status).toBe(0);
            expect(result.stdout.toLowerCase()).toContain('config');

        });

        it('--version works before the subcommand', () => {

            const result = runCli(project, ['--version']);

            expect(result.status).toBe(0);
            expect(result.stdout.trim().length).toBeGreaterThan(0);

        });

    });

});
