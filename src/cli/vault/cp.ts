/**
 * noorm vault cp <key> <source> <destination> — copy a vault secret between configs.
 *
 * Loads the identity locally and calls copyVaultSecrets with both source and
 * destination configs. Does not use withVaultContext because the SDK function
 * manages dual connections internally.
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
        key: { type: 'positional', description: 'Secret key to copy', required: true },
        source: { type: 'positional', description: 'Source config name', required: true },
        destination: { type: 'positional', description: 'Destination config name', required: true },
        config: sharedArgs.config,
        force: sharedArgs.force,
        dryRun: sharedArgs.dryRun,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const keys = [args.key];
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

        // A dry run goes through the same preflight as the real copy — vault
        // access on both ends, source-key existence, destination collisions —
        // and differs only in that nothing is written. Echoing the arguments
        // back could not answer the question a dry run is asked.
        const [result, copyErr] = await copyVaultSecrets(
            sourceConfig,
            destConfig,
            keys,
            cryptoIdentity.identityHash,
            privateKey,
            cryptoIdentity.publicKey,
            { force: args.force, dryRun: !!args.dryRun },
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

        // `success` tracks the exit code. Reporting true alongside a populated
        // `errors` array made a CI script branching on `.success` read a
        // failed copy as a success.
        const succeeded = !result?.errors?.length;

        if (args.json) {

            process.stdout.write(JSON.stringify({
                success: succeeded,
                dryRun: !!args.dryRun,
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

                const verb = args.dryRun ? 'Would copy' : 'Copied';

                process.stdout.write(`${verb} ${copied.length} secrets: ${copied.join(', ')}\n`);

            }

            if (skipped.length > 0) {

                const verb = args.dryRun ? 'Would skip' : 'Skipped';

                process.stdout.write(`${verb} ${skipped.length} existing secrets: ${skipped.join(', ')}\n`);
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

        process.exit(succeeded ? 0 : 1);

    },
});

(cpCommand as typeof cpCommand & { examples: string[] }).examples = [
    'noorm vault cp API_KEY staging production',
    'noorm vault cp API_KEY staging production --dry-run',
    'noorm vault cp DB_PASSWORD dev staging --force',
    'noorm vault cp API_KEY staging production --json',
];

export default cpCommand;
