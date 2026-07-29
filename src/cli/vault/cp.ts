/**
 * noorm vault cp <key> <source> <destination> — copy a vault secret between configs.
 *
 * Loads the identity locally and calls copyVaultSecrets with both source and
 * destination configs. Does not use withVaultContext because the SDK function
 * manages dual connections internally.
 */
import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';

import { outputResult, outputError, sharedArgs } from '../_utils.js';
import { copyVaultSecrets } from '../../core/vault/index.js';
import { loadPrivateKey, loadIdentityMetadata } from '../../core/identity/storage.js';
import { getStateManager } from '../../core/state/index.js';
import { EXIT } from '../_exit.js';

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

            outputError(args, 'Identity not set up. Run: noorm identity init');
            process.exit(EXIT.FAILURE);

        }

        const [privateKey, keyErr] = await attempt(() => loadPrivateKey());

        if (keyErr || !privateKey) {

            outputError(args, 'Private key not found. Run: noorm identity init');
            process.exit(EXIT.FAILURE);

        }

        const stateManager = getStateManager(process.cwd());
        const [, loadErr] = await attempt(() => stateManager.load());

        if (loadErr) {

            outputError(args, loadErr.message);
            process.exit(EXIT.FAILURE);

        }

        const sourceConfig = stateManager.getConfig(sourceConfigName);
        const destConfig = stateManager.getConfig(destConfigName);

        if (!sourceConfig) {

            outputError(args, `Source config not found: ${sourceConfigName}`);
            process.exit(EXIT.USAGE);

        }

        if (!destConfig) {

            outputError(args, `Destination config not found: ${destConfigName}`);
            process.exit(EXIT.USAGE);

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

            outputError(args, copyErr.message);
            process.exit(EXIT.FAILURE);

        }

        // `success` tracks the exit code. Reporting true alongside a populated
        // `errors` array made a CI script branching on `.success` read a
        // failed copy as a success.
        const succeeded = !result?.errors?.length;

        if (args.json) {

            outputResult(args, {
                success: succeeded,
                dryRun: !!args.dryRun,
                copied: result?.copied ?? [],
                skipped: result?.skipped ?? [],
                errors: result?.errors ?? [],
            }, '');

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
