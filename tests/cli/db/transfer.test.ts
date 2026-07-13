/**
 * cli: noorm db transfer — passphrase floor guard.
 *
 * `db transfer` calls `process.exit`, so — like every other citty command
 * test in this suite — it's driven as a subprocess against the compiled
 * CLI rather than invoked in-process (tests/cli/db/drop.test.ts's pattern).
 * The `.dtzx` guard fires before any connection or identity work, so these
 * tests need no database and no `config`/`identity` fixture — a bare
 * project directory is enough. `HOME` still points at a throwaway tmp dir
 * so a stray discovery read never touches the developer's real `~/.noorm`.
 *
 * Regression under test: `--passphrase` accepted 1-character passphrases
 * on `.dtzx` export, and a bare flag leaks via ps/shell history with no
 * masked alternative. `MIN_PASSPHRASE_LENGTH` (12) is now enforced at this
 * guard site before any connection work; non-interactive callers without
 * the flag get a fast, actionable exit instead of hanging on a stdin read.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'citty';

import transferCommand from '../../../src/cli/db/transfer.js';
import { assertArgsDef } from '../citty-args.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');

/** Strips inherited NOORM_* env vars before applying explicit overrides, so no ambient NOORM_YES/NOORM_CONFIG leaks into a subprocess run. */
function cleanEnvWithOverrides(overrides: Record<string, string | undefined>): Record<string, string> {

    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {

        if (value !== undefined && !key.startsWith('NOORM_')) env[key] = value;

    }

    for (const [key, value] of Object.entries(overrides)) {

        if (value !== undefined) env[key] = value;

    }

    return env;

}

describe('cli: noorm db transfer — passphrase floor', () => {

    let tmpDir: string;
    let fakeHome: string;
    let env: Record<string, string>;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-db-transfer-'));
        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-db-transfer-home-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'paths:\n    sql: ./sql\n');

        env = cleanEnvWithOverrides({ HOME: fakeHome });

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(fakeHome, { recursive: true, force: true });

    });

    function runTransfer(args: string[]) {

        return spawnSync('node', [CLI, 'db', 'transfer', ...args], {
            cwd: tmpDir,
            encoding: 'utf-8',
            env,
        });

    }

    it('rejects a .dtzx export with a passphrase shorter than the minimum', () => {

        const result = runTransfer(['--export', 'backup.dtzx', '--tables', 'users', '--passphrase', 'x']);

        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain('12 characters');

    });

    it('rejects a non-interactive .dtzx export with no --passphrase flag', () => {

        const result = runTransfer(['--export', 'backup.dtzx', '--tables', 'users']);

        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain('--passphrase');

    });

    it('parses --on-conflict into the renamed onConflict arg (invalid value echoes the parsed value)', () => {

        const result = runTransfer(['--export', 'backup.dt', '--tables', 'users', '--on-conflict', 'bogus']);

        expect(result.status).toBe(1);
        expect(result.stdout + result.stderr).toContain('Invalid --on-conflict value: "bogus"');

    });

});

/**
 * checkpoint 3 (v1-24-polish-batch): kebab-declared citty args (`on-conflict`,
 * `batch-size`, `no-fk`, `no-identity`) were renamed to camelCase. These tests
 * exercise citty's real `parseArgs` against the command's actual `args`
 * definition — the exact object citty hands to `run({ args })` — so a broken
 * rename (stale kebab key left in `args`, or an accessor that reads a name
 * citty never populates) fails here without needing a live DB connection.
 */
describe('cli: noorm db transfer — camelCase arg parsing (checkpoint 3)', () => {

    it('parses --on-conflict and --batch-size into onConflict/batchSize', () => {

        const argsDef = transferCommand.args;
        assertArgsDef(argsDef);

        const parsed = parseArgs(['--to', 'backup', '--on-conflict', 'skip', '--batch-size', '500'], argsDef);

        expect(parsed.onConflict).toBe('skip');
        expect(parsed.batchSize).toBe('500');

    });

    it('parses --no-fk and --no-identity without a CLI-arg-parsing error, matching the pre-existing citty negation bug', () => {

        const argsDef = transferCommand.args;
        assertArgsDef(argsDef);

        const parsed = parseArgs(['--to', 'backup', '--no-fk', '--no-identity'], argsDef);

        // Pre-existing bug (out of scope for this checkpoint, not fixed here): citty
        // unconditionally strips any `--no-<x>` token and negates a flag literally
        // named `<x>`, so `--no-fk`/`--no-identity` have never set `noFk`/`noIdentity` —
        // they negate unrelated `fk`/`identity` flags instead. This asserts the rename
        // left that behavior identically unchanged (still broken, not newly broken).
        expect(parsed.noFk).toBeUndefined();
        expect(parsed.noIdentity).toBeUndefined();
        expect(parsed.fk).toBe(false);
        expect(parsed.identity).toBe(false);

    });

});
