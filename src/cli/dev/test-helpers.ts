/**
 * noorm dev test-helpers — test $helpers loading for a template file.
 *
 * Verifies that loadHelpers and buildContext correctly load
 * $helpers files from a template's directory tree. Useful for
 * diagnosing resolution issues in compiled binaries.
 *
 * @example
 * ```bash
 * noorm dev test-helpers sql/core/05_Cron/Crons.sql.tmpl
 * noorm dev test-helpers --json sql/seed.sql.tmpl
 * ```
 */
import { dirname, join, relative } from 'node:path';

import { defineCommand } from 'citty';

import { attempt } from '@logosdx/utils';

import { loadHelpers, findHelperFiles } from '../../core/template/helpers.js';
import { buildContext } from '../../core/template/context.js';
import { outputResult } from '../_utils.js';

const testHelpersCommand = defineCommand({
    meta: {
        name: 'test-helpers',
        description: 'Test $helpers loading for a template file',
    },
    args: {
        json: { type: 'boolean', description: 'Output JSON' },
        template: {
            type: 'positional',
            description: 'Path to the template file (relative to project root)',
            required: true,
        },
    },
    async run({ args }) {

        const projectRoot = process.cwd();
        const templatePath = args.template;
        const fullPath = join(projectRoot, templatePath);
        const templateDir = dirname(fullPath);

        process.stdout.write('\n');
        process.stdout.write('$helpers Diagnostics\n');
        process.stdout.write('─'.repeat(60) + '\n');
        process.stdout.write(`  Template: ${templatePath}\n`);
        process.stdout.write(`  Dir:      ${relative(projectRoot, templateDir)}\n`);
        process.stdout.write('\n');

        // Step 1: Find helper files
        const [helperFiles, findErr] = await attempt(() => findHelperFiles(templateDir, projectRoot));

        if (findErr) {

            process.stderr.write(`  findHelperFiles failed: ${findErr.message}\n`);
            process.exit(1);

        }

        process.stdout.write(`  Found ${helperFiles!.length} $helpers file(s):\n`);

        for (const f of helperFiles!) {

            process.stdout.write(`    ${relative(projectRoot, f)}\n`);

        }

        process.stdout.write('\n');

        // Step 2: Load helpers
        const [helperResult, loadErr] = await attempt(() => loadHelpers(templateDir, projectRoot));

        if (loadErr) {

            process.stderr.write(`  loadHelpers failed: ${loadErr.message}\n`);
            process.exit(1);

        }

        const { helpers, errors } = helperResult!;
        const keys = Object.keys(helpers);

        process.stdout.write(`  Loaded ${keys.length} export(s):\n`);

        for (const key of keys) {

            process.stdout.write(`    $.${key} : ${typeof helpers[key]}\n`);

        }

        if (errors.length > 0) {

            process.stdout.write('\n');
            process.stderr.write(`  ${errors.length} error(s):\n`);

            for (const { filepath, error } of errors) {

                process.stderr.write(`    ${relative(projectRoot, filepath)}: ${error.message}\n`);

            }

        }

        process.stdout.write('\n');

        // Step 3: Build full context
        const [ctx, ctxErr] = await attempt(() => buildContext(fullPath, { projectRoot }));

        if (ctxErr) {

            process.stderr.write(`  buildContext failed: ${ctxErr.message}\n`);
            process.exit(1);

        }

        const ctxKeys = Object.keys(ctx!);
        const helperKeySet: Record<string, true> = {};
        for (const k of keys) helperKeySet[k] = true;

        const builtins: Record<string, true> = {
            quote: true, escape: true, uuid: true, now: true, json: true,
            include: true, config: true, secrets: true, globalSecrets: true, env: true,
        };

        const dataKeys = ctxKeys.filter(k => !builtins[k] && !helperKeySet[k]);

        process.stdout.write(`  Context: ${ctxKeys.length} total keys\n`);
        process.stdout.write(`    Helpers:  ${keys.length}\n`);
        process.stdout.write(`    Data:     ${dataKeys.length} (${dataKeys.join(', ') || 'none'})\n`);
        process.stdout.write(`    Builtins: ${ctxKeys.filter(k => builtins[k]).length}\n`);
        process.stdout.write('\n');
        process.stdout.write('─'.repeat(60) + '\n');

        const status = errors.length === 0 ? 'OK' : `${errors.length} error(s)`;
        process.stdout.write(`  ${status}\n`);
        process.stdout.write('\n');

        if (args.json) {

            outputResult(args, {
                templatePath,
                helperFiles: helperFiles!.map(f => relative(projectRoot, f)),
                helpers: keys.map(k => ({ key: k, type: typeof helpers[k] })),
                errors: errors.map(e => ({ filepath: relative(projectRoot, e.filepath), message: e.error.message })),
                dataKeys,
                totalContextKeys: ctxKeys.length,
            }, '');

        }

        process.exit(errors.length > 0 ? 1 : 0);

    },
});

(testHelpersCommand as typeof testHelpersCommand & { examples: string[] }).examples = [
    'noorm dev test-helpers sql/core/05_Cron/Crons.sql.tmpl',
    'noorm dev test-helpers --json sql/seed.sql.tmpl',
];

export default testHelpersCommand;
