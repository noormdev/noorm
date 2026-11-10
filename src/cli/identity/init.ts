/**
 * noorm identity init — create a cryptographic identity, or complete one around an existing private key.
 *
 * Generates an X25519 keypair and saves keys + metadata to ~/.noorm/. A private key that is
 * already there is kept: the public key is derived from it and the metadata written.
 * Required before using any config sharing or team discovery features.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { createCryptoIdentity, detectIdentityDefaults, ensureIdentity } from '../../core/identity/factory.js';
import { backupKeyPair, getKeyOverride, hasPrivateKeyFile, IDENTITY_REPLACE_WARNING, loadIdentityMetadata, loadPublicKey } from '../../core/identity/storage.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const initCommand = defineCommand({
    meta: { name: 'init', description: 'Create a cryptographic identity, or complete one around an existing private key' },
    args: {
        name: { type: 'string', description: 'Your display name (default: git config user.name, then the OS username)' },
        email: { type: 'string', description: 'Your email address (default: git config user.email)' },
        force: {
            type: 'boolean',
            description: 'Replace the existing identity (destroys all local state; requires --yes)',
            default: false,
        },
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        // The private key alone: a key restored without its .pub is still
        // what every state.enc on the machine is encrypted with.
        const existing = await hasPrivateKeyFile();
        const flagName = args.name?.trim();
        const flagEmail = args.email?.trim();

        // The override stands in for a key file, so completing "the existing key" would write only identity.pub and report success.
        if (!existing && getKeyOverride()) {

            outputError(
                args,
                'NOORM_IDENTITY_PRIVATE_KEY is set, so this process already has an identity and no key would be written to ~/.noorm. '
                + 'Unset it to create an identity on this machine.',
            );
            process.exit(1);

        }

        const stored = existing && !args.force ? await loadIdentityMetadata() : null;

        if (stored && await loadPublicKey()) {

            outputError(args, 'Identity already exists. Use --force to overwrite.');
            process.exit(1);

        }

        // Stored metadata wins in ensureIdentity, so there is nothing to ask git or the flags for.
        const detected = stored || (flagName && flagEmail) ? null : detectIdentityDefaults();
        const name = stored?.name || flagName || detected?.name;
        const email = stored?.email || flagEmail || detected?.email;

        if (!email) {

            outputError(args, 'Could not determine your email: git config user.email is not set. Pass --email <address>.');
            process.exit(1);

        }

        if (!name) {

            outputError(args, 'Could not determine your name. Pass --name <name>.');
            process.exit(1);

        }

        let backups: string[] = [];

        if (existing && args.force) {

            // Deliberately the raw flag, not isYesMode(): an ambient NOORM_YES
            // set for unattended runs must not be able to destroy every
            // project's state as a side effect.
            if (!args.yes) {

                outputError(args, `${IDENTITY_REPLACE_WARNING} Pass --yes to confirm.`);
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

        // Without --force an existing key is never replaced, so a key that cannot be loaded is an error to fix by hand.
        const [result, err] = await attempt(() =>
            (args.force ? createCryptoIdentity({ name, email }) : ensureIdentity({ name, email })),
        );

        if (err) {

            outputError(args, existing && !args.force ? err.message : `Failed to create identity: ${err.message}`);
            process.exit(1);

        }

        const { identity } = result;
        const completedExistingKey = existing && !args.force;

        const textLines = [
            completedExistingKey ? 'Identity completed from the existing private key.' : 'Identity created.',
            `  Name:        ${identity.name}`,
            `  Email:       ${identity.email}`,
            `  Fingerprint: ${identity.identityHash}`,
        ];

        if (backups.length > 0) {

            textLines.push(
                '',
                `WARNING: ${IDENTITY_REPLACE_WARNING}`,
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
                ...(completedExistingKey ? { completedExistingKey: true } : {}),
                ...(backups.length > 0 ? { backedUpTo: backups, warning: IDENTITY_REPLACE_WARNING } : {}),
            },
            textLines.join('\n'),
        );
        process.exit(0);

    },
});

(initCommand as typeof initCommand & { examples: string[] }).examples = [
    'noorm identity init',
    'noorm identity init --name "Alice Smith" --email alice@example.com',
    'noorm identity init --name "Alice Smith" --email alice@example.com --force --yes',
];

export default initCommand;
