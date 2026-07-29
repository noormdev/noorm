/**
 * cli: `noorm run build` names `build.exclude` entries that matched nothing.
 *
 * `include` got this warning; `exclude` did not, and it is the half that
 * fails dangerously. A mistyped include over-restricts and announces itself
 * by running nothing. A mistyped exclude fences off nothing — the seeds,
 * fixtures or destructive DDL the author held back execute against the
 * target database, `status: success`, exit 0, no signal anywhere.
 *
 * The canonical instance is the `sql/` prefix mistake: patterns are
 * relative to `paths.sql`, so `sql/10_seeds` means `sql/sql/10_seeds`.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
    cleanupProject,
    extractJsonObject,
    runCli,
    setupProject,
    type TestProject,
} from './_setup.js';

interface BuildPayload {
    status: string;
    filesRun: number;
    unmatchedExclude?: string[];
}

/**
 * Project with one seed file and a `build.exclude` entry written the way
 * the audit found it in the wild.
 */
async function setupExcludeProject(excludeEntry: string): Promise<TestProject> {

    const project = await setupProject();

    await mkdir(join(project.dir, 'sql', '10_seeds'), { recursive: true });
    await writeFile(
        join(project.dir, 'sql', '10_seeds', 'seed.sql'),
        'CREATE TABLE excluded_probe (id INTEGER PRIMARY KEY);\n',
    );

    await writeFile(
        join(project.dir, '.noorm', 'settings.yml'),
        `build:\n  exclude:\n    - ${excludeEntry}\n`,
    );

    return project;

}

describe('cli: noorm run build — unmatched build.exclude entries', () => {

    let project: TestProject | undefined;

    afterEach(async () => {

        if (project) await cleanupProject(project);
        project = undefined;

    });

    it('should report an exclude entry that matched no files in --json', async () => {

        project = await setupExcludeProject('sql/10_seeds');

        const result = runCli(project, ['run', 'build', '--json']);
        const jsonText = extractJsonObject(result.stdout);

        expect(jsonText).not.toBeNull();

        const payload = JSON.parse(jsonText!) as BuildPayload;

        // The file ran despite being "excluded" — that is the damage. The
        // key is what lets CI notice it.
        expect(payload.filesRun).toBe(1);
        expect(payload.unmatchedExclude).toEqual(['sql/10_seeds']);

    });

    it('should warn in human output that nothing was excluded', async () => {

        project = await setupExcludeProject('sql/10_seeds');

        const result = runCli(project, ['run', 'build']);
        const out = result.stdout + result.stderr;

        expect(out).toContain('sql/10_seeds');
        expect(out).toMatch(/exclude/i);

    });

    it('should stay silent when the exclude entry matches', async () => {

        project = await setupExcludeProject('10_seeds');

        const result = runCli(project, ['run', 'build', '--json']);
        const jsonText = extractJsonObject(result.stdout);

        const payload = JSON.parse(jsonText!) as BuildPayload;

        expect(payload.filesRun).toBe(0);
        expect(payload.unmatchedExclude).toBeUndefined();

    });

});
