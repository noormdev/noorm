/**
 * cli: the `--json` envelope contract.
 *
 * WHY: the headless audit measured four mutually incompatible success shapes
 * across the 72 `--json` commands — `{version,…}`, `{configs}`, a bare array
 * from `change list`/`change history`/every `db explore` list, and
 * `{success,path}` from `settings build`. Only the *error* payload was
 * uniform. A CI consumer therefore had no single success check: `jq -e
 * '.success'` was null-or-absent on most successes and errored outright on
 * the array-returning commands, leaving the exit code as the only
 * discriminator — and that was inconsistent too.
 *
 * The contract these tests pin:
 *   1. every `--json` payload is a JSON *object*, never a bare array;
 *   2. it carries a top-level boolean `success`;
 *   3. `success` and the exit code agree — exit 0 iff `success === true`.
 *
 * Rule 3 is the one that matters most: it is what makes "reported success
 * while doing nothing" impossible to express in the envelope.
 *
 * Driven as subprocesses against the compiled CLI because every command
 * calls `process.exit`, which would kill an in-process runner.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
    CLI,
    TMP_BASE,
    cleanupProject,
    setupProject,
    type TestProject,
} from './run/_setup.js';

/**
 * Every `--json` command reachable from the SQLite env-only harness.
 *
 * Deliberately mixes successes with failures: the contract is about the
 * envelope holding on *both* sides, and a suite that only sampled happy
 * paths is how the four incompatible shapes survived to begin with.
 */
const JSON_COMMANDS: string[][] = [
    ['version'],
    ['info'],
    ['config', 'list'],
    ['change', 'list'],
    ['change', 'history'],
    ['lock', 'status'],
    ['lock', 'acquire'],
    ['lock', 'release'],
    ['identity', 'list'],
    ['db', 'explore'],
    ['db', 'explore', 'tables'],
    ['db', 'explore', 'views'],
    ['db', 'explore', 'indexes'],
    ['db', 'explore', 'fks'],
    ['db', 'explore', 'functions'],
    ['db', 'explore', 'procedures'],
    ['db', 'explore', 'types'],
    ['run', 'build'],
    ['settings', 'build'],
    // Failure paths — the envelope has to survive these unchanged.
    ['secret', 'list'],
    ['config', 'validate', 'does-not-exist'],
    ['run', 'inspect', 'sql/nope.sql.tmpl'],
    ['run', 'preview', 'sql/nope.sql.tmpl'],
    ['run', 'dir', 'does-not-exist'],
];

interface Envelope {
    success?: unknown;
    error?: unknown;
    [key: string]: unknown;
}

/** Parse the last complete JSON document on stdout — logger lines may precede it. */
function parseEnvelope(stdout: string): Envelope | null {

    const start = stdout.indexOf('{');

    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < stdout.length; i++) {

        const ch = stdout[i]!;

        if (escaped) {

            escaped = false;
            continue;

        }

        if (ch === '\\') {

            escaped = true;
            continue;

        }

        if (ch === '"') {

            inString = !inString;
            continue;

        }

        if (inString) continue;

        if (ch === '{') depth++;
        else if (ch === '}') {

            depth--;

            if (depth === 0) return JSON.parse(stdout.slice(start, i + 1)) as Envelope;

        }

    }

    return null;

}

describe('cli: --json envelope contract', () => {

    let project: TestProject;

    beforeAll(async () => {

        await mkdir(TMP_BASE, { recursive: true });

    });

    beforeEach(async () => {

        project = await setupProject();
        await writeFile(join(project.dir, 'sql', '01_ok.sql'), 'CREATE TABLE envelope_t (id INTEGER PRIMARY KEY);\n', 'utf-8');

    });

    afterEach(async () => {

        await cleanupProject(project);

    });

    for (const command of JSON_COMMANDS) {

        const label = command.join(' ');

        it(`should emit an object carrying a boolean success for: ${label} --json`, () => {

            const result = spawnSync('node', [CLI, ...command, '--json'], {
                cwd: project.dir,
                encoding: 'utf-8',
                env: { ...process.env, ...project.env },
            });

            const stdout = typeof result.stdout === 'string' ? result.stdout : '';

            // A bare array is the shape this contract exists to eliminate:
            // it has nowhere to put `success`, so a consumer parsing it can
            // only guess whether the command did anything.
            expect(stdout.trimStart().startsWith('[')).toBe(false);

            const payload = parseEnvelope(stdout);

            expect(payload).not.toBeNull();
            expect(typeof payload!.success).toBe('boolean');

        });

        it(`should agree between success and exit code for: ${label} --json`, () => {

            const result = spawnSync('node', [CLI, ...command, '--json'], {
                cwd: project.dir,
                encoding: 'utf-8',
                env: { ...process.env, ...project.env },
            });

            const payload = parseEnvelope(typeof result.stdout === 'string' ? result.stdout : '');

            expect(payload).not.toBeNull();

            // The invariant that makes the envelope trustworthy: a command
            // cannot claim success in JSON while signalling failure to the
            // shell, or the reverse.
            expect(payload!.success).toBe(result.status === 0);

        });

    }

    it('should carry an error string on every unsuccessful envelope', () => {

        const result = spawnSync('node', [CLI, 'run', 'inspect', 'sql/nope.sql.tmpl', '--json'], {
            cwd: project.dir,
            encoding: 'utf-8',
            env: { ...process.env, ...project.env },
        });

        const payload = parseEnvelope(typeof result.stdout === 'string' ? result.stdout : '');

        expect(payload!.success).toBe(false);
        expect(typeof payload!.error).toBe('string');

    });

});
