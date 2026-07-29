/**
 * noorm identity export — display your public key.
 *
 * Loads identity metadata from ~/.noorm/ and prints the public key
 * so it can be shared with teammates for encrypted config sharing.
 */
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { loadIdentityMetadata, loadPublicKey } from '../../core/identity/storage.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';
import { EXIT } from '../_exit.js';

const exportCommand = defineCommand({
    meta: { name: 'export', description: 'Display your public key' },
    args: {
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [identity, identityErr] = await attempt(() => loadIdentityMetadata());

        if (identityErr || !identity) {

            outputError(
                args,
                'No identity found. Run `noorm identity init` to create one.',
            );
            process.exit(EXIT.USAGE);

        }

        const [publicKey, keyErr] = await attempt(() => loadPublicKey());

        if (keyErr || !publicKey) {

            outputError(args, 'Failed to load public key. Identity files may be corrupted.');
            process.exit(1);

        }

        outputResult(
            args,
            {
                name: identity.name,
                email: identity.email,
                fingerprint: identity.identityHash,
                publicKey,
            },
            `Public Key\n  Name:        ${identity.name}\n  Email:       ${identity.email}\n  Fingerprint: ${identity.identityHash}\n\n${publicKey}`,
        );
        process.exit(0);

    },
});

(exportCommand as typeof exportCommand & { examples: string[] }).examples = [
    'noorm identity export',
    'noorm identity export --json',
];

export default exportCommand;
