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
import { parseArgs } from 'citty';

import enrollCommand from '../../../src/cli/ci/identity/enroll.js';
import { assertArgsDef } from '../citty-args.js';

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

/**
 * checkpoint 3 (v1-24-polish-batch): `'public-key'` was renamed to `publicKey`.
 * The happy path needs a live DB (see the file header), so `--public-key`'s
 * value never surfaces in an observable subprocess side effect before this
 * checkpoint's flag-parsing risk area. Instead this exercises citty's real
 * `parseArgs` against the command's actual `args` definition — the exact
 * object citty hands to `run({ args })` — proving `--public-key` still lands
 * on `publicKey` without needing a live DB connection.
 */
describe('cli: noorm ci identity enroll — camelCase arg parsing (checkpoint 3)', () => {

    it('parses --public-key into the renamed publicKey arg', () => {

        const argsDef = enrollCommand.args;
        assertArgsDef(argsDef);

        const parsed = parseArgs(
            ['--config', 'prod', '--name', 'CI Bot', '--email', 'ci@test.com', '--public-key', 'deadbeef'],
            argsDef,
        );

        expect(parsed.publicKey).toBe('deadbeef');

    });

});
