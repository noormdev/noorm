/**
 * noorm vault cp — copy vault secrets between configs.
 *
 * With --all: vault cp --all <source> <dest>
 * Without --all: vault cp <key> <source> <dest>
 */
import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';

import { sharedArgs } from '../_utils.js';
import { copyVaultSecrets } from '../../core/vault/index.js';
import { loadPrivateKey, loadIdentityMetadata } from '../../core/identity/storage.js';
import { getStateManager } from '../../core/state/index.js';

const cpCommand = defineCommand({
    meta: {
        name: 'cp',
        description: 'Copy vault secrets between configs',
    },
    args: {
        source: { type: 'positional', description: 'Source config name', required: true },
        destination: { type: 'positional', description: 'Destination config name', required: true },
        key: { type: 'string', description: 'Secret key to copy (omit to copy all)' },
        config: sharedArgs.config,
        force: sharedArgs.force,
        dryRun: sharedArgs.dryRun,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const keys: string[] | 'all' = args.key ? [args.key] : 'all';
        const sourceConfigName = args.source;
        const destConfigName = args.destination;

        const [cryptoIdentity, identityErr] = await attempt(() => loadIdentityMetadata());

        if (identityErr || !cryptoIdentity) {

            process.stderr.write('Error: Identity not set up. Run: noorm identity init\n');
            process.exit(1);

        }

        const [privateKey, keyErr] = await attempt(() => loadPrivateKey());

        if (keyErr || !privateKey) {

            process.stderr.write('Error: Private key not found. Run: noorm identity init\n');
            process.exit(1);

        }

        const stateManager = getStateManager(process.cwd());
        const [, loadErr] = await attempt(() => stateManager.load());

        if (loadErr) {

            process.stderr.write(`Error: ${loadErr.message}\n`);
            process.exit(1);

        }

        const sourceConfig = stateManager.getConfig(sourceConfigName);
        const destConfig = stateManager.getConfig(destConfigName);

        if (!sourceConfig) {

            process.stderr.write(`Error: Source config not found: ${sourceConfigName}\n`);
            process.exit(1);

        }

        if (!destConfig) {

            process.stderr.write(`Error: Destination config not found: ${destConfigName}\n`);
            process.exit(1);

        }

        if (args.dryRun) {

            const dryRunResult = {
                success: true,
                dryRun: true,
                source: sourceConfigName,
                destination: destConfigName,
                keys: keys === 'all' ? 'all' : keys,
                force: args.force ?? false,
            };

            if (args.json) {

                process.stdout.write(JSON.stringify(dryRunResult) + '\n');

            }
            else {

                process.stdout.write(
                    `Dry run: would copy ${keys === 'all' ? 'all secrets' : keys.join(', ')} from "${sourceConfigName}" to "${destConfigName}"\n`,
                );

                if (args.force) {

                    process.stdout.write('With --force: would overwrite existing secrets\n');

                }

            }

            process.exit(0);

        }

        const [result, copyErr] = await copyVaultSecrets(
            sourceConfig,
            destConfig,
            keys,
            cryptoIdentity.identityHash,
            privateKey,
            cryptoIdentity.publicKey,
            { force: args.force },
        );

        if (copyErr) {

            if (args.json) {

                process.stdout.write(JSON.stringify({ success: false, error: copyErr.message }) + '\n');

            }
            else {

                process.stderr.write(`Error: ${copyErr.message}\n`);

            }

            process.exit(1);

        }

        if (args.json) {

            process.stdout.write(JSON.stringify({
                success: true,
                copied: result?.copied ?? [],
                skipped: result?.skipped ?? [],
                errors: result?.errors ?? [],
            }) + '\n');

        }
        else {

            const copied = result?.copied ?? [];
            const skipped = result?.skipped ?? [];
            const errors = result?.errors ?? [];

            if (copied.length > 0) {

                process.stdout.write(`Copied ${copied.length} secrets: ${copied.join(', ')}\n`);

            }

            if (skipped.length > 0) {

                process.stdout.write(`Skipped ${skipped.length} existing secrets: ${skipped.join(', ')}\n`);
                process.stdout.write('Use --force to overwrite\n');

            }

            if (errors.length > 0) {

                for (const e of errors) {

                    process.stderr.write(`Failed to copy "${e.key}": ${e.error}\n`);

                }

            }

            if (copied.length === 0 && skipped.length === 0 && errors.length === 0) {

                process.stdout.write('No secrets to copy\n');

            }

        }

        process.exit(result?.errors?.length ? 1 : 0);

    },
});

(cpCommand as typeof cpCommand & { examples: string[] }).examples = [
    'noorm vault cp staging production --key API_KEY',
    'noorm vault cp staging production',
    'noorm vault cp staging production --force',
    'noorm vault cp staging production --dry-run',
    'noorm vault cp staging production --json',
];

export default cpCommand;
