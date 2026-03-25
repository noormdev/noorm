/**
 * Dev command: test $helpers loading for a template file.
 *
 * Verifies that loadHelpers and buildContext correctly load
 * $helpers files from a template's directory tree. Useful for
 * diagnosing resolution issues in compiled binaries.
 *
 * @example
 * ```bash
 * noorm -H dev/test-helpers sql/core/05_Cron/Crons.sql.tmpl
 * ```
 */
import { dirname, join, relative } from 'node:path';

import { attempt } from '@logosdx/utils';

import { loadHelpers } from '../../core/template/helpers.js';
import { findHelperFiles } from '../../core/template/helpers.js';
import { buildContext } from '../../core/template/context.js';
import type { Logger } from '../../core/logger/index.js';
import type { RouteParams, CliFlags } from '../types.js';

export const help = `
# dev test-helpers

Internal diagnostic — tests $helpers loading for a template file.

## Usage

    noorm -H dev/test-helpers <template-path>

## Example

    noorm -H dev/test-helpers sql/core/05_Cron/Crons.sql.tmpl
`;

export async function run(
    params: RouteParams,
    flags: CliFlags,
    logger: Logger,
): Promise<number> {

    const projectRoot = process.cwd();
    const templatePath = params.path;

    if (!templatePath) {

        logger.error('Usage: noorm -H dev/test-helpers <template-path>');

        return 1;

    }

    const fullPath = join(projectRoot, templatePath);
    const templateDir = dirname(fullPath);

    logger.info('');
    logger.info('$helpers Diagnostics');
    logger.info('─'.repeat(60));
    logger.info(`  Template: ${templatePath}`);
    logger.info(`  Dir:      ${relative(projectRoot, templateDir)}`);
    logger.info('');

    // Step 1: Find helper files
    const [helperFiles, findErr] = await attempt(() => findHelperFiles(templateDir, projectRoot));

    if (findErr) {

        logger.error(`  findHelperFiles failed: ${findErr.message}`);

        return 1;

    }

    logger.info(`  Found ${helperFiles!.length} $helpers file(s):`);

    for (const f of helperFiles!) {

        logger.info(`    ${relative(projectRoot, f)}`);

    }

    logger.info('');

    // Step 2: Load helpers
    const [helperResult, loadErr] = await attempt(() => loadHelpers(templateDir, projectRoot));

    if (loadErr) {

        logger.error(`  loadHelpers failed: ${loadErr.message}`);

        return 1;

    }

    const { helpers, errors } = helperResult!;
    const keys = Object.keys(helpers);

    logger.info(`  Loaded ${keys.length} export(s):`);

    for (const key of keys) {

        logger.info(`    $.${key} : ${typeof helpers[key]}`);

    }

    if (errors.length > 0) {

        logger.info('');
        logger.error(`  ${errors.length} error(s):`);

        for (const { filepath, error } of errors) {

            logger.error(`    ${relative(projectRoot, filepath)}: ${error.message}`);

        }

    }

    logger.info('');

    // Step 3: Build full context
    const [ctx, ctxErr] = await attempt(() => buildContext(fullPath, { projectRoot }));

    if (ctxErr) {

        logger.error(`  buildContext failed: ${ctxErr.message}`);

        return 1;

    }

    const ctxKeys = Object.keys(ctx!);
    const helperKeySet = new Set(keys);
    const builtins = new Set(['quote', 'escape', 'uuid', 'now', 'json', 'include', 'config', 'secrets', 'globalSecrets', 'env']);
    const dataKeys = ctxKeys.filter(k => !builtins.has(k) && !helperKeySet.has(k));

    logger.info(`  Context: ${ctxKeys.length} total keys`);
    logger.info(`    Helpers:  ${keys.length}`);
    logger.info(`    Data:     ${dataKeys.length} (${dataKeys.join(', ') || 'none'})`);
    logger.info(`    Builtins: ${ctxKeys.filter(k => builtins.has(k)).length}`);
    logger.info('');
    logger.info('─'.repeat(60));

    const status = errors.length === 0 ? 'OK' : `${errors.length} error(s)`;
    logger.info(`  ${status}`);
    logger.info('');

    if (flags.json) {

        logger.result({
            templatePath,
            helperFiles: helperFiles!.map(f => relative(projectRoot, f)),
            helpers: keys.map(k => ({ key: k, type: typeof helpers[k] })),
            errors: errors.map(e => ({ filepath: relative(projectRoot, e.filepath), message: e.error.message })),
            dataKeys,
            totalContextKeys: ctxKeys.length,
        });

    }

    return errors.length > 0 ? 1 : 0;

}
