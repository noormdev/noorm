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
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.run.build({ force: args.force }).then((res) => {

                    if (!args.json) {

                        for (const file of res.files) {

                            if (file.status === 'failed') {

                                logger.error(`${file.filepath} (failed)`);
                                if (file.error) logger.error(`  error: ${file.error}`);

                            }
                            else if (file.status === 'skipped' && file.skipReason) {

                                logger.info(`${file.filepath} (skipped: ${file.skipReason})`);

                            }

                        }

                        const summary = {
                            status: res.status,
                            filesRun: res.filesRun,
                            filesSkipped: res.filesSkipped,
                            filesFailed: res.filesFailed,
                            durationMs: res.durationMs,
                        };

                        if (res.status === 'success') {

                            logger.info('Build completed', summary);

                        }
                        else {

                            logger.error('Build completed', summary);

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, result, '');

        }

        process.exit(result.status === 'success' ? 0 : 2);

    },
});

(buildCommand as typeof buildCommand & { examples: string[] }).examples = [
    'noorm run build',
    'noorm run build --force',
    'noorm run build --json',
];

export default buildCommand;
