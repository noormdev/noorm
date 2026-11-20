/**
 * noorm change ff — fast-forward apply all pending changes.
 */
import { defineCommand } from 'citty';
import { confirm, isCancel, log, multiselect } from '@clack/prompts';

import type { BatchChangeOptions } from '../../core/change/types.js';
import { isCi } from '../../core/environment.js';
import { isAgentSession, resolveChannel } from '../../core/policy/index.js';

import { isYesMode, withContext, outputResult, sharedArgs } from '../_utils.js';
import { exitCodeForStatus } from '../_exit.js';

const confirmRetirement: NonNullable<BatchChangeOptions['confirmRetirement']> = async (failures) => {

    log.warn(failures.map(({ name, message }) => `${name}: ${message}`).join('\n'));

    const names = await multiselect({
        message: 'Select changes to retire',
        options: failures.map(({ name }) => ({ value: name, label: name })),
        required: false,
    });

    if (isCancel(names) || names.length === 0) return [];

    const confirmed = await confirm({
        message: 'Confirm all supported databases have caught up and rollback is no longer needed for these changes',
        initialValue: false,
    });

    return !isCancel(confirmed) && confirmed ? names : [];

};

const ffCommand = defineCommand({
    meta: {
        name: 'ff',
        description: 'Fast-forward: apply all pending changes',
    },
    args: {
        config: sharedArgs.config,
        force: sharedArgs.force,
        dryRun: sharedArgs.dryRun,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const dryRun = Boolean(args.dryRun);
        const force = Boolean(args.force);
        const canPrompt = !dryRun && !args.json && process.stdin.isTTY && process.stdout.isTTY
            && !isYesMode(args) && !isCi()
            && resolveChannel() === 'user' && !isAgentSession();
        const options: BatchChangeOptions = canPrompt ? { dryRun, force, confirmRetirement } : { dryRun, force };

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.changes.ff(options).then((res) => {

                    if (!args.json) {

                        if (dryRun) {

                            logger.info('Dry run: rendering changes to tmp/ (no DB writes)');

                        }

                        // Warned, not failed: without this an absent changes/
                        // directory reads exactly like an up-to-date database.
                        for (const warning of res.warnings ?? []) {

                            logger.warn(warning);

                        }

                        const summary = {
                            executed: res.executed,
                            skipped: res.skipped,
                            failed: res.failed,
                            ...(dryRun ? { dryRun: true } : {}),
                        };

                        const headerPrefix = dryRun ? 'Fast-forward (dry-run)' : 'Fast-forward';

                        if (res.status === 'success') {

                            logger.info(`${headerPrefix} ${res.status}`, summary);

                        }
                        else {

                            logger.error(`${headerPrefix} ${res.status}`, summary);

                        }

                        for (const cs of res.changes) {

                            if (cs.status === 'failed') {

                                logger.error(`  ${cs.name} (failed)`);
                                if (cs.error) logger.error(`    error: ${cs.error}`);

                            }
                            else {

                                const suffix = dryRun ? `${cs.status}, dry-run` : cs.status;
                                logger.info(`  ${cs.name} (${suffix})`);

                            }

                        }

                    }

                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            // Annotate the JSON payload with the dry-run flag so callers in
            // CI pipelines can detect that the result didn't touch the DB
            // without having to also parse the surrounding human output.
            const payload = dryRun ? { ...result, dryRun: true } : result;
            outputResult(args, payload, '');

        }

        process.exit(exitCodeForStatus(result.status));

    },
});

(ffCommand as typeof ffCommand & { examples: string[] }).examples = [
    'noorm change ff',
    'noorm change ff -c prod',
    'noorm change ff --dry-run',
    'noorm change ff --force',
];

export default ffCommand;
