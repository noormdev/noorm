/**
 * Executable side-cars in a template's directory.
 *
 * `loadDataFilesInDir` auto-loaded every file with a registered extension,
 * and `.js`/`.mjs`/`.ts` are registered — so any script sitting next to a
 * SQL file was `import()`ed, unsandboxed, as part of building the template
 * context. The template did not have to mention it, and `run preview`,
 * `run inspect` and `run build --dry-run` all triggered it. That turned
 * "look at this unfamiliar project before running it" into arbitrary code
 * execution as the invoking user.
 *
 * The rule these tests pin: a script runs only when the template asks for
 * its data. Inert formats (json/yaml/csv) keep auto-loading — they cannot
 * execute anything, and requiring a reference for them would break every
 * existing project for no security gain.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { processFile } from '../../../src/core/template/engine.js';
import { buildContext } from '../../../src/core/template/context.js';

describe('template: executable side-cars', () => {

    let dir: string;
    let marker: string;

    /**
     * A side-car whose only observable effect is a file on disk — stands in
     * for the `execSync` / credential read a real payload would do.
     */
    async function writePayload(name: string): Promise<void> {

        await writeFile(
            join(dir, name),
            'import { writeFileSync } from \'node:fs\';\n' +
            `writeFileSync(${JSON.stringify(marker)}, 'executed');\n` +
            'export default { label: \'from-sidecar\' };\n',
            'utf-8',
        );

    }

    beforeEach(async () => {

        dir = await mkdtemp(join(tmpdir(), 'noorm-sidecar-'));
        marker = join(dir, 'payload-ran.txt');

    });

    afterEach(async () => {

        await rm(dir, { recursive: true, force: true });

    });

    it('should not execute a side-car the template never references', async () => {

        await writePayload('payload.js');

        const template = join(dir, 'probe.sql.tmpl');
        await writeFile(template, 'SELECT 1;\n', 'utf-8');

        const result = await processFile(template, { projectRoot: dir });

        expect(result.sql).toBe('SELECT 1;');
        expect(existsSync(marker)).toBe(false);

    });

    it('should not execute an unreferenced side-car while inspecting context', async () => {

        await writePayload('payload.ts');

        const template = join(dir, 'probe.sql.tmpl');
        await writeFile(template, 'SELECT 1;\n', 'utf-8');

        // `run inspect` builds the context without rendering — the command
        // a user reaches for precisely because it does not execute anything.
        const ctx = await buildContext(template, { projectRoot: dir });

        expect(existsSync(marker)).toBe(false);
        expect(ctx['payload']).toBeUndefined();

    });

    it('should load a side-car the template does reference', async () => {

        await writePayload('payload.js');

        const template = join(dir, 'probe.sql.tmpl');
        await writeFile(template, "SELECT '{%~ $.payload.label %}';\n", 'utf-8');

        const result = await processFile(template, { projectRoot: dir });

        expect(result.sql).toBe("SELECT 'from-sidecar';");
        expect(existsSync(marker)).toBe(true);

    });

    it('should recognise bracket access as a reference', async () => {

        await writePayload('payload.js');

        const template = join(dir, 'probe.sql.tmpl');
        await writeFile(template, "SELECT '{%~ $['payload'].label %}';\n", 'utf-8');

        const result = await processFile(template, { projectRoot: dir });

        expect(result.sql).toBe("SELECT 'from-sidecar';");

    });

    it('should keep auto-loading inert data files without a reference', async () => {

        await writeFile(join(dir, 'seed.json'), JSON.stringify({ label: 'inert' }), 'utf-8');

        const template = join(dir, 'probe.sql.tmpl');
        await writeFile(template, 'SELECT 1;\n', 'utf-8');

        const ctx = await buildContext(template, { projectRoot: dir });

        expect(ctx['seed']).toEqual({ label: 'inert' });

    });

});
