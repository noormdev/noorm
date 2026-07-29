/**
 * noorm identity init — create a new cryptographic identity.
 *
 * Generates an X25519 keypair and saves keys + metadata to ~/.noorm/.
 * Required before using any config sharing or team discovery features.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { createCryptoIdentity } from '../../core/identity/factory.js';
import { backupKeyPair, hasKeyFiles } from '../../core/identity/storage.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

/**
 * Why regenerating an identity is not just "overwrite existing identity":
 * the state encryption key is derived from the private key, so a new keypair
 * orphans every state.enc on the machine.
 */
const DESTRUCTIVE_WARNING =
    'Regenerating your identity re-keys state encryption. Every noorm project on this machine — '
    + 'its configs, secrets and database passwords in .noorm/state/state.enc — becomes permanently '
    + 'undecryptable. Nothing re-encrypts existing state under the new key.';

const initCommand = defineCommand({
    meta: { name: 'init', description: 'Create a new cryptographic identity' },
    args: {
        name: { type: 'string', description: 'Your display name', required: true },
        email: { type: 'string', description: 'Your email address', required: true },
        force: {
            type: 'boolean',
            description: 'Replace the existing identity (destroys all local state; requires --yes)',
            default: false,
        },
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [existing] = await attempt(() => hasKeyFiles());

        if (existing && !args.force) {

            outputError(args, 'Identity already exists. Use --force to overwrite.');
            process.exit(1);

        }

        let backups: string[] = [];

        if (existing) {

            // Deliberately the raw flag, not isYesMode(): an ambient NOORM_YES
            // set for unattended runs must not be able to destroy every
            // project's state as a side effect.
            if (!args.yes) {

                outputError(args, `${DESTRUCTIVE_WARNING} Pass --yes to confirm.`);
                process.exit(1);

            }

            const [backedUp, backupErr] = await attempt(() => backupKeyPair());

            if (backupErr) {

                outputError(
                    args,
                    `Refusing to overwrite: could not back up the existing identity (${backupErr.message}). `
                    + 'Without a backup this operation is unrecoverable.',
                );
                process.exit(1);

            }

            backups = backedUp;

        }

        const [result, err] = await attempt(() =>
            createCryptoIdentity({ name: args.name, email: args.email }),
        );

        if (err) {

            outputError(args, `Failed to create identity: ${err.message}`);
            process.exit(1);

        }

        const { identity } = result;

        const textLines = [
            'Identity created.',
            `  Name:        ${identity.name}`,
            `  Email:       ${identity.email}`,
            `  Fingerprint: ${identity.identityHash}`,
        ];

        if (backups.length > 0) {

            textLines.push(
                '',
                `WARNING: ${DESTRUCTIVE_WARNING}`,
                '',
                'Previous identity backed up to:',
                ...backups.map((path) => `  ${path}`),
                '',
                'Restore identity.key from that backup to regain access to existing state.',
            );

        }

        outputResult(
            args,
            {
                name: identity.name,
                email: identity.email,
                fingerprint: identity.identityHash,
                publicKey: identity.publicKey,
                ...(backups.length > 0 ? { backedUpTo: backups, warning: DESTRUCTIVE_WARNING } : {}),
            },
            textLines.join('\n'),
        );
        process.exit(0);

    },
});

(initCommand as typeof initCommand & { examples: string[] }).examples = [
    'noorm identity init --name "Alice Smith" --email alice@example.com',
    'noorm identity init --name "Alice Smith" --email alice@example.com --force --yes',
];

export default initCommand;
