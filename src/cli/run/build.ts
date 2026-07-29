/**
 * noorm run build — execute all SQL files in the schema directory.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const buildCommand = defineCommand({
    meta: {
        name: 'build',
        description: 'Execute all SQL files in schema directory',
    },
    args: {
        config: sharedArgs.config,
        force: sharedArgs.force,
        dryRun: sharedArgs.dryRun,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const dryRun = Boolean(args.dryRun);

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.run.build({ force: args.force, dryRun }).then((res) => {

                    if (!args.json) {

                        if (dryRun) {

                            logger.info('Dry run: rendering files to tmp/ (no DB writes)');

                        }

                        // Warned, not failed: matching nothing is a settings mistake, and
                        // without this the build reports plain success over zero files.
                        if (res.unmatchedInclude?.length) {

                            logger.warn(
                                `Ignored ${res.unmatchedInclude.length} build.include entr` +
                                `${res.unmatchedInclude.length === 1 ? 'y that matched' : 'ies that matched'} no files: ` +
                                res.unmatchedInclude.join(', '),
                            );
                            logger.warn('Include paths are relative to paths.sql — use `01_tables`, not `sql/01_tables`.');

                        }

                        for (const file of res.files) {

                            if (file.status === 'failed') {

                                logger.error(`${file.filepath} (failed)`);
                                if (file.error) logger.error(`  error: ${file.error}`);

                            }
                            else if (file.status === 'skipped' && file.skipReason) {

                                logger.info(`${file.filepath} (skipped: ${file.skipReason})`);

                            }
                            else if (dryRun) {

                                logger.info(`${file.filepath} (${file.status}, dry-run)`);

                            }

                        }

                        const summary = {
                            status: res.status,
                            filesRun: res.filesRun,
                            filesSkipped: res.filesSkipped,
                            filesFailed: res.filesFailed,
                            durationMs: res.durationMs,
                            ...(dryRun ? { dryRun: true } : {}),
                        };

                        const headerPrefix = dryRun ? 'Build (dry-run)' : 'Build';

                        if (res.status === 'success') {

                            logger.info(`${headerPrefix} completed`, summary);

                        }
                        else {

                            logger.error(`${headerPrefix} completed`, summary);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            // Annotate the JSON payload with the dry-run flag, matching
            // `change ff --dry-run`, so CI can detect a no-write result
            // without parsing human output.
            const payload = dryRun ? { ...result, dryRun: true } : result;
            outputResult(args, payload, '');

        }

        process.exit(result.status === 'success' ? 0 : 2);

    },
});

(buildCommand as typeof buildCommand & { examples: string[] }).examples = [
    'noorm run build',
    'noorm run build --force',
    'noorm run build --dry-run',
    'noorm run build --json',
];

export default buildCommand;
