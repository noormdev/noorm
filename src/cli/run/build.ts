/**
 * noorm run build — execute all SQL files in the schema directory.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';
import { exitCodeForStatus } from '../_exit.js';

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

                            // Named explicitly because the rendered files carry
                            // every secret the templates resolved, and `tmp/` is
                            // not gitignored by a project noorm scaffolds.
                            logger.info('Dry run: rendering files to tmp/ (no DB writes)');
                            logger.warn('Rendered files contain resolved secrets in plaintext — written owner-only, not gitignored.');

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

                        // Louder than the include case on purpose: an entry
                        // that excluded nothing means the files the author
                        // fenced off just ran against the target database.
                        if (res.unmatchedExclude?.length) {

                            logger.warn(
                                `Ignored ${res.unmatchedExclude.length} build.exclude entr` +
                                `${res.unmatchedExclude.length === 1 ? 'y that matched' : 'ies that matched'} no files: ` +
                                res.unmatchedExclude.join(', ') +
                                ' — nothing was excluded, so those files ran.',
                            );
                            logger.warn('Exclude paths are relative to paths.sql — use `10_seeds`, not `sql/10_seeds`.');

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

                                const destination = file.outputPath ? ` -> ${file.outputPath}` : '';
                                logger.info(`${file.filepath} (${file.status}, dry-run)${destination}`);

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

        process.exit(exitCodeForStatus(result.status));

    },
});

(buildCommand as typeof buildCommand & { examples: string[] }).examples = [
    'noorm run build',
    'noorm run build --force',
    'noorm run build --dry-run',
    'noorm run build --json',
];

export default buildCommand;
