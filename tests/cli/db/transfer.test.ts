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
 * `batch-size`) were renamed to camelCase. These tests exercise citty's real
 * `parseArgs` against the command's actual `args` definition — the exact object
 * citty hands to `run({ args })` — so a broken rename (stale kebab key left in
 * `args`, or an accessor that reads a name citty never populates) fails here
 * without needing a live DB connection.
 *
 * `no-fk`/`no-identity` were part of that rename but could not survive it; they
 * are covered by the negation suite below instead.
 */
describe('cli: noorm db transfer — camelCase arg parsing (checkpoint 3)', () => {

    it('parses --on-conflict and --batch-size into onConflict/batchSize', () => {

        const argsDef = transferCommand.args;
        assertArgsDef(argsDef);

        const parsed = parseArgs(['--to', 'backup', '--on-conflict', 'skip', '--batch-size', '500'], argsDef);

        expect(parsed.onConflict).toBe('skip');
        expect(parsed.batchSize).toBe('500');

    });

});

/**
 * citty strips any `--no-<x>` token and negates a flag literally named `<x>`,
 * so a boolean declared as `noFk` could never be set by the documented
 * `--no-fk` — the token negated an undeclared `fk` and was discarded, leaving
 * `noFk` undefined and the flag a silent no-op that still exited 0.
 *
 * The fix declares the positive names (`fk`, `identity`) defaulted to `true`
 * and lets citty's own negation carry `--no-fk`/`--no-identity`, so the
 * documented spelling is the one the parser actually implements.
 */
describe('cli: noorm db transfer — --no-fk / --no-identity negation', () => {

    /** Parses argv against the real command definition, so a regression in the args block fails here. */
    function parseTransfer(argv: string[]) {

        const argsDef = transferCommand.args;
        assertArgsDef(argsDef);

        return parseArgs(['--to', 'backup', ...argv], argsDef);

    }

    it('defaults fk and identity to true when neither flag is passed', () => {

        const parsed = parseTransfer([]);

        expect(parsed.fk).toBe(true);
        expect(parsed.identity).toBe(true);

    });

    it('sets fk false on --no-fk, leaving identity untouched', () => {

        const parsed = parseTransfer(['--no-fk']);

        expect(parsed.fk).toBe(false);
        expect(parsed.identity).toBe(true);

    });

    it('sets identity false on --no-identity, leaving fk untouched', () => {

        const parsed = parseTransfer(['--no-identity']);

        expect(parsed.fk).toBe(true);
        expect(parsed.identity).toBe(false);

    });

    it('sets both false when both flags are passed', () => {

        const parsed = parseTransfer(['--no-fk', '--no-identity']);

        expect(parsed.fk).toBe(false);
        expect(parsed.identity).toBe(false);

    });

    it('no longer exposes the unreachable noFk/noIdentity args', () => {

        const argsDef = transferCommand.args;
        assertArgsDef(argsDef);

        expect(argsDef).not.toHaveProperty('noFk');
        expect(argsDef).not.toHaveProperty('noIdentity');

    });

});
