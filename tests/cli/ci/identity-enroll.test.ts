/**
 * noorm ci identity enroll — argument-validation tests.
 *
 * The full happy path requires:
 * - a live postgres/mysql/mssql DB (Docker fixture)
 * - a bootstrapped noorm schema with an existing identity that holds
 *   vault access, so the caller can decrypt the vault key and propagate
 *
 * Those paths live with the rest of the DB-touching integration suite
 * (`tests/integration/cli/`). Here we cover the precondition paths that
 * don't require a connection.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist/cli/index.js');

describe('cli: noorm ci identity enroll', () => {

    let tmpDir: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-ci-enroll-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('exits non-zero when --config is missing', () => {

        const result = spawnSync(
            'node',
            [CLI, 'ci', 'identity', 'enroll', '--name', 'CI Bot', '--email', 'ci@test.com'],
            { cwd: tmpDir, encoding: 'utf-8' },
        );

        expect(result.status).not.toBe(0);

    });

    it('exits non-zero when --name is missing', () => {

        const result = spawnSync(
            'node',
            [CLI, 'ci', 'identity', 'enroll', '--config', 'prod', '--email', 'ci@test.com'],
            { cwd: tmpDir, encoding: 'utf-8' },
        );

        expect(result.status).not.toBe(0);

    });

    it('exits non-zero when --email is missing', () => {

        const result = spawnSync(
            'node',
            [CLI, 'ci', 'identity', 'enroll', '--config', 'prod', '--name', 'CI Bot'],
            { cwd: tmpDir, encoding: 'utf-8' },
        );

        expect(result.status).not.toBe(0);

    });

});
