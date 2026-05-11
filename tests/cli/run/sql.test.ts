/**
 * cli: noorm sql — query subcommand and bare-SQL argv rewriting.
 *
 * Regression target: prior to slice 2, `noorm sql "SELECT 1"` resolved
 * to a citty subcommand lookup and printed `Unknown command SELECT 1`
 * because the parent's positional `query` arg was unreachable.
 *
 * Slice 2 deletes the dead parent handler and installs an argv rewriter
 * in `src/cli/index.ts` that promotes a bare SQL-looking token to the
 * `query` subcommand. The explicit `noorm sql query "<SQL>"` form was
 * (and remains) the always-correct invocation.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { mkdir } from 'node:fs/promises';

import {
    cleanupProject,
    extractJsonObject,
    runCli,
    setupProject,
    TMP_BASE,
    type TestProject,
} from './_setup.js';

interface QueryResult {
    success?: boolean;
    rows?: unknown[];
    columns?: string[];
}

describe('cli: noorm sql', () => {

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

    it('should execute SQL via the explicit `query` subcommand', () => {

        const result = runCli(project, ['sql', 'query', 'SELECT 1 AS one']);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('one');
        expect(result.stdout).toContain('1');

    });

    it('should execute SQL via the explicit `query` subcommand with --json', () => {

        const result = runCli(project, ['sql', 'query', '--json', 'SELECT 1 AS one']);

        expect(result.status).toBe(0);

        const jsonStr = extractJsonObject(result.stdout);
        expect(jsonStr).not.toBeNull();

        const parsed: QueryResult = JSON.parse(jsonStr!);
        expect(parsed.success).toBe(true);
        expect(parsed.rows?.length).toBe(1);

    });

    it('should rewrite `sql "<SQL>"` to `sql query "<SQL>"` (bare form)', () => {

        const result = runCli(project, ['sql', 'SELECT 1 AS one']);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('one');
        expect(result.stdout).toContain('1');

    });

    it('should rewrite the bare form even with flags interleaved', () => {

        const result = runCli(project, ['sql', '--json', 'SELECT 1 AS one']);

        expect(result.status).toBe(0);

        const jsonStr = extractJsonObject(result.stdout);
        expect(jsonStr).not.toBeNull();

        const parsed: QueryResult = JSON.parse(jsonStr!);
        expect(parsed.success).toBe(true);

    });

    it('should not rewrite when the first token is a real subcommand', () => {

        const result = runCli(project, ['sql', 'history', '--help']);

        // `history` is a real subcommand, so the rewriter must leave it
        // alone. citty's --help prints usage and exits 0.
        expect(result.status).toBe(0);
        expect(result.stdout.toLowerCase()).toContain('history');

    });

    it('should advertise the `query` subcommand in `sql --help`', () => {

        const result = runCli(project, ['sql', '--help']);

        expect(result.status).toBe(0);
        const out = result.stdout + result.stderr;
        expect(out).toContain('query');

    });

});
