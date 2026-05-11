/**
 * Test harness for CLI run/* and change/* commands.
 *
 * Sets up an isolated SQLite project on disk and provides spawn/JSON
 * helpers so each test can invoke the compiled CLI as a real subprocess.
 * SQLite is used for portability — no docker containers are required.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { Kysely } from 'kysely';

import { createConnection } from '../../../src/core/connection/factory.js';
import { bootstrapSchema } from '../../../src/core/version/index.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';

export const CLI = join(process.cwd(), 'dist/cli/index.js');
export const TMP_BASE = join(process.cwd(), 'tmp');

export interface TestProject {
    dir: string;
    dbPath: string;
    env: Record<string, string>;
}

/**
 * Create an isolated SQLite-backed noorm project under `tmp/` and
 * bootstrap the internal tracking schema.
 *
 * Each project gets its own directory so tests can run in parallel
 * (or in any order) without sharing state.
 */
export async function setupProject(): Promise<TestProject> {

    const testId = randomUUID().slice(0, 8);
    const dir = join(TMP_BASE, `cli-run-test-${testId}`);
    const dbPath = join(dir, '.noorm', 'test.db');
    const sqlDir = join(dir, 'sql');

    await mkdir(sqlDir, { recursive: true });
    // .noorm/ anchors project root discovery — without it the CLI walks
    // up to the repo's own .noorm and uses the repo as the project root.
    await mkdir(join(dir, '.noorm'), { recursive: true });
    await mkdir(join(dir, 'changes'), { recursive: true });

    const conn = await createConnection({ dialect: 'sqlite', database: dbPath }, '__test__');
    // cast-justified: createConnection returns Kysely<unknown>; bootstrapSchema
    // needs Kysely<NoormDatabase> to type the internal tracking tables. The
    // freshly-bootstrapped DB has those tables by definition.
    await bootstrapSchema(conn.db as Kysely<NoormDatabase>, 'sqlite');
    await conn.destroy();

    return {
        dir,
        dbPath,
        env: {
            NOORM_CONNECTION_DIALECT: 'sqlite',
            NOORM_CONNECTION_DATABASE: dbPath,
            NOORM_PATHS_SQL: './sql',
            NOORM_PATHS_CHANGESETS: './changes',
            NOORM_NAME: '__test__',
            NOORM_ISTEST: 'true',
            NOORM_IDENTITY: 'cli-run-tester',
        },
    };

}

export async function cleanupProject(project: TestProject): Promise<void> {

    await rm(project.dir, { recursive: true, force: true });

}

export interface CliResult {
    stdout: string;
    stderr: string;
    status: number | null;
}

/**
 * Invoke the compiled CLI as a subprocess inside the test project.
 *
 * Inherits the caller's PATH so `node` resolves, but overrides
 * NOORM_* env vars so the CLI runs in env-only headless mode.
 *
 * Wraps `spawnSync` to return narrowed `string` stdout/stderr so
 * callers don't have to repeatedly coerce away the Buffer union
 * that node's type declarations carry on the `encoding` overload.
 */
export function runCli(project: TestProject, args: string[]): CliResult {

    const result = spawnSync('node', [CLI, ...args], {
        cwd: project.dir,
        encoding: 'utf-8',
        env: { ...process.env, ...project.env },
    });

    return {
        stdout: typeof result.stdout === 'string' ? result.stdout : '',
        stderr: typeof result.stderr === 'string' ? result.stderr : '',
        status: result.status,
    };

}

/**
 * Extract the first balanced top-level JSON object from CLI stdout.
 *
 * The CLI may print logger lines after the JSON result, and rendering
 * a `--json` summary doesn't strip surrounding output. This walker
 * counts braces while respecting string literals so embedded `{` /
 * `}` inside SQL or error messages don't throw off the boundaries.
 */
export function extractJsonObject(stdout: string): string | null {

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

            if (depth === 0) return stdout.slice(start, i + 1);

        }

    }

    return null;

}
