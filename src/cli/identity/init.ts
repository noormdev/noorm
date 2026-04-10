/**
 * noorm identity init — create a new cryptographic identity.
 *
 * Generates an X25519 keypair and saves keys + metadata to ~/.noorm/.
 * Required before using any config sharing or team discovery features.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { createCryptoIdentity } from '../../core/identity/factory.js';
import { hasKeyFiles } from '../../core/identity/storage.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

const initCommand = defineCommand({
    meta: { name: 'init', description: 'Create a new cryptographic identity' },
    args: {
        name: { type: 'string', description: 'Your display name', required: true },
        email: { type: 'string', description: 'Your email address', required: true },
        force: { type: 'boolean', description: 'Overwrite existing identity', default: false },
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [existing] = await attempt(() => hasKeyFiles());

        if (existing && !args.force) {

            outputError(args, 'Identity already exists. Use --force to overwrite.');
            process.exit(1);

        }

        const [result, err] = await attempt(() =>
            createCryptoIdentity({ name: args.name, email: args.email }),
        );

        if (err) {

            outputError(args, `Failed to create identity: ${err.message}`);
            process.exit(1);

        }

        const { identity } = result;

        outputResult(
            args,
            {
                name: identity.name,
                email: identity.email,
                fingerprint: identity.identityHash,
                publicKey: identity.publicKey,
            },
            `Identity created.\n  Name:        ${identity.name}\n  Email:       ${identity.email}\n  Fingerprint: ${identity.identityHash}`,
        );
        process.exit(0);

    },
});

(initCommand as typeof initCommand & { examples: string[] }).examples = [
    'noorm identity init --name "Alice Smith" --email alice@example.com',
    'noorm identity init --name "Alice Smith" --email alice@example.com --force',
];

export default initCommand;
